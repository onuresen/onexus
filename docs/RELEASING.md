# Releasing ONEXUS

ONEXUS uses [Semantic Versioning](https://semver.org/). A release is an
**immutable, verifiable** snapshot an administrator can pin, deploy, and roll
back to. This document is the process; `.github/workflows/onexus-release.yml`
enforces the mechanical parts.

## Canonical sources of truth

| Fact | Source |
|---|---|
| Version | `VERSION` (a single SemVer line, e.g. `1.0.0`) |
| What changed | `CHANGELOG.md` (a matching `## [x.y.z] - YYYY-MM-DD` section) |
| Reviewed code | the annotated tag `vX.Y.Z`, which must descend from `main` |

These three must agree. The release workflow refuses to publish if they don't.

## Support line (honest scope)

Only the **latest released minor line** is supported (see `SECURITY.md`). This is
a single-maintainer project: no LTS, no backports promised. Do not advertise
multi-version support that no maintainer is committed to providing.

## Cutting a release

1. **Land the work on `main`** via reviewed PR. CI (lint + smoke) must be green.
2. **Bump `VERSION`** to the new `x.y.z`.
3. **Update `CHANGELOG.md`:** move `Unreleased` items into a new
   `## [x.y.z] - YYYY-MM-DD` section (today's date), and refresh the compare
   links at the bottom.
4. **Commit** these to `main` (e.g. `chore(release): v x.y.z`).
5. **Tag** the release commit with an annotated tag that matches `VERSION`:
   ```bash
   git tag -a v1.0.0 -m "ONEXUS v1.0.0"
   git push origin v1.0.0
   ```
6. The **release workflow** fires on the `v*` tag and:
   - verifies the tag name equals `VERSION` (`vX.Y.Z` ↔ `X.Y.Z`);
   - verifies a matching `CHANGELOG.md` section exists;
   - verifies the tag commit is contained in `main` (ancestry);
   - reinstalls deps and **reruns lint + smoke at the tag**;
   - builds a clean archive **excluding** git metadata, `node_modules`,
     `test-results`, and dev scratch (see the workflow's exclude list);
   - computes a **SHA-256** checksum of the archive;
   - publishes an immutable **GitHub Release** with the archive + `.sha256`.

If any check fails, no Release is published — fix and re-tag (delete the bad tag
first). **Never** replace an already-published release asset in place.

## Verifying a release (for an administrator)

```bash
# Download onexus-<version>.tar.gz and onexus-<version>.tar.gz.sha256 from the Release
sha256sum -c onexus-<version>.tar.gz.sha256   # must print: OK
```

Then deploy the extracted folder atomically and keep the archive + checksum for
rollback. See `docs/DEPLOYMENT.md`.

## Data-schema caveat

ONEXUS reads legacy `onexus-1.x` graph files and normalizes edges to
`onexus.relationship.v1` on import without invalidating older files, so moving
between releases does not corrupt existing data files. Call out any
schema-affecting change explicitly in `CHANGELOG.md`.
