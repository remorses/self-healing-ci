#!/usr/bin/env bun

import * as core from "@actions/core";
import * as github from "@actions/github";
import { Octokit } from "@octokit/rest";
import { $ } from "bun";
import os from "os";
import path from "path";
import Handlebars from "handlebars";

const { owner, repo } = github.context.repo;
const actor = github.context.actor;
const buildCommand = process.env.INPUT_RUN as string;
const maxAttempts = parseInt(process.env.INPUT_MAX_ATTEMPTS || "3");
const model = process.env.INPUT_MODEL || "anthropic/claude-sonnet-4-20250514";

if (!buildCommand) {
  core.setFailed("INPUT_RUN is required");
  process.exit(1);
}



let appToken: string;
let octoRest: Octokit;
let gitCredentials: string;

async function run() {
  try {
    appToken = process.env.GITHUB_TOKEN!;
    if (!appToken) {
      throw new Error("GITHUB_TOKEN environment variable is not set");
    }

    octoRest = new Octokit({ auth: appToken });
    await configureGit(appToken);
    await assertPermissions();

    console.log("BuildMedic: CI self-healing agent started");
    console.log(`Command: ${buildCommand}`);
    console.log(`Max attempts: ${maxAttempts}`);

    // Create a branch for the agent to work on
    const runId = process.env.GITHUB_RUN_ID!;
    const branch = `buildmedic/fix-build-${runId}`;
    console.log(`Creating branch: ${branch}`);
    await $`git checkout -b ${branch}`;

    // First, run the command without OpenCode to capture any errors
    console.log("Running build command first to check for failures...");
    let commandFailed = false;
    let combinedOutput = "";

    try {
      // Run command with stdout and stderr interleaved (2>&1)
      const result = await $`bash -c ${buildCommand} 2>&1`;
      combinedOutput = result.text();
      console.log("Build command succeeded on first run. No fixes needed.");
      await restoreGitConfig();
      process.exit(0);
    } catch (e: any) {
      commandFailed = true;
      if (e instanceof $.ShellError) {
        // When using 2>&1, all output goes to stdout
        combinedOutput = e.text();
      }
      console.log("Build command failed. Collecting error details for self-healing...");
    }

    // If command failed, pass the error details to OpenCode
    if (commandFailed) {
      // Get the last 1000 lines of combined output
      const outputLines = combinedOutput.split('\n');
      const last1000Lines = outputLines.slice(-1000).join('\n');

      const prompt = await buildSelfHealingPrompt({
        buildCommand,
        maxAttempts,
        initialError: last1000Lines
      });
      const response = await runOpencode(prompt, { share: false });
    }

    await restoreGitConfig();

    // Check if buildmedic fail was called and exit with appropriate code
    const statusCodePath = `${process.env.GITHUB_ACTION_PATH}/STATUS_CODE`;
    const statusCodeFile = Bun.file(statusCodePath);
    if (await statusCodeFile.exists()) {
      const statusCode = await statusCodeFile.text();
      process.exit(parseInt(statusCode.trim()) || 0);
    }

  } catch (e: any) {
    await restoreGitConfig();
    console.error(e);
    let msg = e;
    if (e instanceof $.ShellError) {
      msg = e.stderr.toString();
    } else if (e instanceof Error) {
      msg = e.message;
    }
    core.setFailed(`BuildMedic failed with error: ${msg}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  run();
}

async function generateGitHubToken() {
  try {
    return await core.getIDToken("buildmedic-github-action");
  } catch (error) {
    console.error("Failed to get OIDC token:", error);
    throw new Error(
      "Could not fetch an OIDC token. Make sure to add `id-token: write` to your workflow permissions.",
    );
  }
}

async function exchangeForAppToken(oidcToken: string) {
  const response = await fetch(
    "https://api.frank.dev.opencode.ai/exchange_github_app_token",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oidcToken}`,
      },
    },
  );

  if (!response.ok) {
    const responseJson = (await response.json()) as { error?: string };
    throw new Error(
      `App token exchange failed: ${response.status} ${response.statusText} - ${responseJson.error}`,
    );
  }

  const responseJson = (await response.json()) as { token: string };
  return responseJson.token;
}

async function buildSelfHealingPrompt(opts: { buildCommand: string; maxAttempts: number; initialError?: string }): Promise<string> {
  const { buildCommand, maxAttempts, initialError } = opts;

  // Read the prompt template from file
  const promptPath = path.join(__dirname, "prompt.md");
  const promptTemplate = await Bun.file(promptPath).text();

  // Compile the template with Handlebars
  const template = Handlebars.compile(promptTemplate);

  // Render the template with the provided variables
  return template({
    buildCommand,
    maxAttempts,
    initialError
  });
}


async function configureGit(appToken: string) {
  console.log("Configuring git...");
  const config = "http.https://github.com/.extraheader";
  const ret = await $`git config --local --get ${config}`;
  gitCredentials = ret.stdout.toString().trim();

  const newCredentials = Buffer.from(
    `x-access-token:${appToken}`,
    "utf8",
  ).toString("base64");

  await $`git config --local --unset-all ${config}`;
  await $`git config --local ${config} "AUTHORIZATION: basic ${newCredentials}"`;
  await $`git config --global user.name "buildmedic[bot]"`;
  await $`git config --global user.email "buildmedic[bot]@users.noreply.github.com"`;
}


async function restoreGitConfig() {
  if (!gitCredentials) return;
  const config = "http.https://github.com/.extraheader";
  await $`git config --local ${config} "${gitCredentials}"`;
}

async function assertPermissions() {
  console.log(`Asserting permissions for user ${actor}...`);

  let permission;
  try {
    const response = await octoRest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: actor,
    });

    permission = response.data.permission;
    console.log(`  permission: ${permission}`);
  } catch (error) {
    console.error(`Failed to check permissions: ${error}`);
    throw new Error(`Failed to check permissions for user ${actor}: ${error}`);
  }

  if (!["admin", "write"].includes(permission))
    throw new Error(`User ${actor} does not have write permissions`);
}


async function runOpencode(
  prompt: string,
  opts?: {
    share?: boolean;
  },
) {
  console.log("Running opencode...");

  const promptPath = path.join(os.tmpdir(), "PROMPT");
  await Bun.write(promptPath, prompt);
  const ret = await $`cat ${promptPath} | opencode run -m ${
    model
  } ${opts?.share ? "--share" : ""}`;
  return {
    stdout: ret.stdout.toString().trim(),
    stderr: ret.stderr.toString().trim(),
  };
}

async function branchIsDirty() {
  console.log("Checking if branch is dirty...");
  const ret = await $`git status --porcelain`;
  return ret.stdout.toString().trim().length > 0;
}
