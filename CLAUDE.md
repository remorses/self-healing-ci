# Self-Healing CI Project

## Overview
This project implements a "self-healing" GitHub Action called **BuildMedic** that automatically fixes broken CI builds using AI. When a build fails, it attempts to diagnose and repair the code, then creates a pull request with the fix.

## What it does
1. **Runs your build command** - Executes the specified build/test command
2. **Detects failures** - If the command fails, it activates the self-healing process
3. **Attempts automated fixes** - Uses AI (via OpenCode/Claude) to analyze errors and modify code
4. **Retries with fixes** - Re-runs the build command after each fix attempt
5. **Creates pull requests** - When successful, pushes fixes to a new branch and opens a PR

## Key Components

### Main Action (`action.yml`)
- GitHub Action configuration that sets up the environment
- Installs Node.js, Bun, and the OpenCode CLI
- Configures the buildmedic script as an executable
- Runs the main TypeScript entry point

### Core Logic (`src/index.ts`)
- Main orchestration logic for the self-healing process
- Handles GitHub authentication and git configuration
- Creates a new branch for fixes (`buildmedic/fix-build-{runId}`)
- Generates prompts for the AI agent with specific workflow instructions
- Manages the overall process flow and error handling

### BuildMedic CLI (`src/buildmedic.ts`)
- Command-line interface for creating pull requests
- Used by the AI agent to create PRs after successful fixes
- Takes title and message parameters to create GitHub PRs

### Type Definitions (`src/types.ts`)
- TypeScript type definitions for GitHub API responses
- Defines structures for pull requests, issues, comments, reviews, etc.

## How it works
1. **Setup**: The action sets up the environment and installs dependencies
2. **Branch creation**: Creates a new branch for potential fixes
3. **AI delegation**: Passes control to an AI agent (OpenCode/Claude) with specific instructions
4. **Iterative fixing**: The AI agent:
   - Runs the build command
   - If it fails, analyzes the error
   - Modifies code to fix the issue
   - Commits the changes
   - Retries the build (up to `max_attempts` times)
5. **PR creation**: If successful, uses the buildmedic CLI to create a pull request

## Configuration
- `command`: The build/test command to run (required)
- `max_attempts`: Maximum number of fix attempts (default: 3)
- `model`: AI model to use for BuildMedic (default: claude-3-5-sonnet-20241022)
- Uses GitHub token for authentication and PR creation permissions

## Usage Example
```yaml
- uses: remorses/buildmedic@main
  with:
    command: "npm ci && npm run build"
    model: "claude-3-5-sonnet-20241022"  # optional
```

## Technology Stack
- **Runtime**: Bun (JavaScript/TypeScript runtime)
- **GitHub Integration**: Octokit REST API, GitHub Actions toolkit
- **AI Integration**: OpenCode CLI (interfaces with Anthropic Claude)
- **CLI Framework**: CAC (Command And Conquer) for the buildmedic command
- **Language**: TypeScript with ES modules

## Project Structure
```
src/
├── index.ts          # Main action entry point
├── buildmedic.ts     # CLI for creating pull requests
└── types.ts          # TypeScript type definitions
```

The project is designed to be a reusable GitHub Action that can be dropped into any repository to add self-healing capabilities to CI/CD pipelines.