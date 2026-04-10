---
inclusion: auto
description: Documentation update requirements for every code change.
---

# Documentation Workflow

After every code change (feature, bugfix, refactor), update the following:

## 1. README.md
- Update relevant sections (CLI flags, configuration, workflow examples)
- Keep the Source Modules table current

## 2. CHANGELOG.md
- Add entry under the current version
- Follow existing format: version header, feature name with ticket reference, bullet points
- Include all user-facing changes

## 3. YouTrack
- Create ticket before work begins (LSG project)
- Add closing comment with version and summary
- Set Stage to Done or Staging

## 4. GitHub Wiki
- If the change affects architecture, data flow, or API integrations, update the relevant wiki page
- Wiki URL: https://github.com/aenaos/bandcamp-scraper/wiki

## Commit format
```
<type>: <description> (vX.Y.Z, LSG-XX)
```
Types: fix, feat, refactor, docs, chore, perf, test
