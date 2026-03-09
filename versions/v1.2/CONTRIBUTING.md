# Contributing

Thank you for your interest in contributing to ONEXUS. Contributions are welcome — issues, fixes, improvements, and examples all help.

Please follow these simple steps so your contribution can be reviewed and merged quickly.

## Report an issue
- Search existing issues first.
- If none match, open a new issue with a short title and reproduction steps or sample JSON.

## Propose a change (Pull Request)
1. Fork the repository and create a topic branch named `fix/your-topic` or `feat/your-topic`.
2. Make your change in `src/` or add examples to `json/` or `versions/` as appropriate.
3. Keep changes focused and include a short description in the PR.

## Local development / Preview
Open `index.html` directly in a browser for quick checks, or run a simple static server:

```bash
npx http-server .
# then open http://localhost:8080
```

Or with Python 3:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Coding style
- Keep changes minimal and consistent with existing files in `src/`.
- Prefer clear variable names and small, well-scoped functions.

## Commit message guidance
- Use imperative, short subject lines: `Fix: update legend rendering` or `Feat: add large-sample dataset`.

## Pull request checklist
- [ ] Related issue opened (if applicable)
- [ ] Branch is up to date with `main` (or repository default)
- [ ] Code is focused and documented where necessary
- [ ] Example JSON or demo updated (if feature affects data)

## No tests yet
There are no automated tests in this repo currently. If you add tests, include instructions in this file.

## Questions
If you're unsure about a change, open an issue first to discuss.

---

Thanks — your contributions keep this project useful for everyone.

