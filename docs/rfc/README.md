# RFCs

Short documents that record a design decision before or while it is built. Goal: a reader in six months knows **what was decided, why, and what was rejected**.

## Process

1. Copy `0000-template.md` to `NNNN-short-title.md` (next free number).
2. Status `Draft`. Open a PR; discussion happens in the PR.
3. Owner sets `Accepted` or `Rejected` on merge. `Superseded by NNNN` when replaced.
4. Code that contradicts an Accepted RFC is a bug in the code or a reason for a new RFC. Never edit history; supersede.

When an RFC is needed: anything that changes the architecture, a shared contract, or adds a dependency with a real trade-off. Not needed: bug fixes, local refactors.

## Index

| #    | Title                                        | Status   |
| ---- | -------------------------------------------- | -------- |
| 0001 | Module Federation for the frontend           | Accepted |
| 0002 | Sharing auth state between shell and remotes | Accepted |
| 0003 | Native Federation comparison                 | Accepted |
| 0004 | Versioned remotes via manifest               | Accepted |
| 0005 | Prefetch remotes on idle                     | Accepted |
| 0006 | Data between remotes                         | Accepted |
| 0007 | Routing inside remotes                       | Accepted |
| 0008 | Design system versioning                     | Accepted |
| 0009 | Feature flags                                | Accepted |
| 0010 | Error tracking per remote                    | Accepted |
