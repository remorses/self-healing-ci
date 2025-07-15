#!/usr/bin/env bun

import { cac } from 'cac'
import { $ } from 'bun'
import * as github from '@actions/github'

const cli = cac('buildmedic')

cli
  .command('')
  .option('--title <title>', 'Title for the PR')
  .option('--message <message>', 'Body message for the PR')
  .action(async (options) => {
    const { title, message } = options
    
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
      console.error('Failed to create pull request:', error)
      process.exit(1)
    }
  })

cli.help()
cli.parse()