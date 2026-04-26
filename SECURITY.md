# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 4.10.x  | ✅ Active support (current) |
| 4.9.x   | ⚠️ Security fixes only |
| 3.x     | ❌ No longer supported |
| 2.x     | ❌ No longer supported |
| 1.x     | ❌ No longer supported |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities privately via one of these methods:

1. **GitHub Security Advisories** (preferred): Go to [Security → Advisories → New draft advisory](https://github.com/falkmerten/label-site-generator/security/advisories/new) on this repository.
2. **Email**: Send details to the repository maintainer with the subject line `[SECURITY] Label Site Generator`.

### What to include

- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgement**: within 48 hours
- **Initial assessment**: within 7 days
- **Fix release**: as soon as practical, typically within 14 days for critical issues

### What happens next

1. We confirm receipt and assess severity
2. We develop and test a fix on a private branch
3. We release a patched version and publish a security advisory
4. You are credited in the advisory (unless you prefer anonymity)

## Scope

This policy covers the Label Site Generator codebase, including:

- Server-side Node.js code (`src/`, `generate.js`)
- HTML templates (`templates/`)
- Client-side JavaScript rendered into the static site
- Credential handling (`.env` configuration)

Out of scope:

- Third-party APIs (Bandcamp, Spotify, Soundcharts, Discogs, etc.)
- Self-hosted newsletter systems (Sendy, Listmonk, Keila) - report to their respective maintainers
- Infrastructure configuration (AWS, Nginx) - these are user-managed

## Security Measures

The project implements the following security practices:

- **HTML sanitization**: All user-generated content (Markdown, news articles, Ghost CMS posts) is sanitized via DOMPurify before rendering
- **Credential isolation**: All API keys and secrets are stored in `.env` (gitignored), never committed
- **Input validation**: Artist/album names normalized via NFD decomposition; slug generation strips non-alphanumeric characters
- **Dependency scanning**: CodeQL analysis runs on every push to `master`
- **No eval/exec**: No dynamic code execution from user input
