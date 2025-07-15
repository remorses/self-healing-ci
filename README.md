# Self‑Healing CI 🏥

_A reusable GitHub Action that lets [Anthropic Claude](https://www.anthropic.com/) repair a broken build and raise a pull‑request with the fix._



---

## Quick start

1. **Give the default `GITHUB_TOKEN` PR rights**
   _Repo → Settings → Actions → General → “Allow GitHub Actions to create and approve pull requests”._

2. **Drop the job in any repo**

   ```yaml
   # .github/workflows/ci.yml
   name: CI

   permissions:
     contents: write # push branch
     pull-requests: write # open PR

   jobs:
     build:
       runs-on: ubuntu-latest
       env:
         GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

       steps:
         - uses: actions/checkout@main

         - uses: remorses/buildmedic@main
           with:
             run: "npm ci && npm run build"
             model: "claude-3-5-sonnet-20241022"  # optional, defaults to claude-3-5-sonnet-20241022
   ```
