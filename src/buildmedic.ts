#!/usr/bin/env bun

import * as github from '@actions/github'
import { $ } from 'bun'
import { cac } from 'cac'
import { execSync } from 'node:child_process'
import { Octokit } from '@octokit/rest'
// @ts-ignore
import parse from 'diffparser'

function isRunningForPR(): boolean {
  // Check if GITHUB_EVENT_NAME is 'pull_request' or 'pull_request_target'
  const eventName = process.env.GITHUB_EVENT_NAME
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    return true
  }

  // Check if github.context indicates a PR
  if (github.context.eventName === 'pull_request' || github.context.eventName === 'pull_request_target') {
    return true
  }

  return false
}

async function postReviewFromDirtyChanges(options?: { message?: string }): Promise<void> {
  const { owner, repo } = github.context.repo
  const pullNumber = github.context.payload.pull_request?.number

  if (!pullNumber) {
    throw new Error('No pull request number found in context')
  }

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is not set')
  }

  const octokit = new Octokit({ auth: token })

  // Get the base branch from the PR context
  const baseBranch = github.context.payload.pull_request?.base.sha
  if (!baseBranch) {
    throw new Error('Could not determine base branch from PR context')
  }

  // Get diff of unpushed commits (staged + unstaged changes)
  const diff = execSync(`git diff --unified=0 ${baseBranch}...HEAD`, { encoding: 'utf8' })

  if (!diff.trim()) {
    console.log('No changes to comment on')
    return
  }

  const files = parse(diff)

  type ReviewComment = { path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }
  const comments: ReviewComment[] = []

  for (const file of files) {
    if (file.to === '/dev/null') continue // whole-file deletion → can't comment
    const path = file.to || file.from // fall back to original

    for (const { changes } of file.chunks) {
      for (const change of changes) {
        if (change.add) {
          // Addition
          comments.push({
            path,
            line: change.newLine!,
            side: 'RIGHT',
            body: `\`\`\`suggestion\n${change.content.replace(/^\+/, '')}\n\`\`\``
          })
        } else if (change.del) {
          // Deletion
          comments.push({
            path,
            line: change.oldLine!,
            side: 'LEFT',
            body: ''
          })
        }
      }
    }
  }

  if (!comments.length) {
    console.log('No additions or deletions to comment on')
    return
  }

  // Create review with inline comments
  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    event: 'COMMENT',
    body: options?.message || 'Automated review from BuildMedic with suggested fixes 🛠️',
    comments
  })

  console.log(`Review posted with ${comments.length} inline comments`)
}

const cli = cac('buildmedic')


cli
  .command('fail')
  .option('--message <message>', 'Failure message')
  .action(async (options) => {
    const { message } = options
    // Fail if GITHUB_ACTION_PATH not available
    if (!process.env.GITHUB_ACTION_PATH) {
      console.error('❌ GITHUB_ACTION_PATH environment variable is not set. Cannot write status file.')
      process.exit(1)
    }
    // Write status code file for the main process to read
    const statusCodePath = `${process.env.GITHUB_ACTION_PATH}/STATUS_CODE`
    await Bun.write(statusCodePath, '1')
    console.error(`❌ ${message || 'Build failed'}`)
    process.exit(0)
  })

cli
  .command('')
  .option('--title <title>', 'Title for the PR')
  .option('--message <message>', 'Body message for the PR')
  .action(async (options) => {
    const { title, message } = options

    if (isRunningForPR()) {
      // If we're in a PR, post review comments instead of creating a new PR
      try {
        await postReviewFromDirtyChanges({ message })
      } catch (error) {
        console.error('Failed to post review:', error)
        process.exit(1)
      }
    } else {
      // If we're not in a PR, create a new PR
      if (!title) {
        console.error('Error: --title is required')
        process.exit(1)
      }

      if (!message) {
        console.error('Error: --message is required')
        process.exit(1)
      }

      try {
        const baseBranch = github.context.ref.replace('refs/heads/', '')

        console.log('Creating pull request...')
        await $`gh pr create --base ${baseBranch} --title ${title} --body ${message}`

        console.log('Pull request created successfully!')
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        
        // Check if the error is due to no changes between branches
        if (errorMessage.includes('no commits between') || 
            errorMessage.includes('No commits between') ||
            errorMessage.includes('nothing to compare') ||
            errorMessage.includes('identical')) {
          
          console.log('No changes detected between branches, creating issue instead...')
          
          try {
            await $`gh issue create --title ${title} --body ${message}`
            console.log('Issue created successfully!')
          } catch (issueError) {
            console.error('Failed to create issue:', issueError)
            process.exit(1)
          }
        } else {
          console.error('Failed to create pull request:', error)
          process.exit(1)
        }
      }
    }
  })

cli.help()
cli.parse()
