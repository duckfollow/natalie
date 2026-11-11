# Natalie

Natalie is a macOS Git client for reviewing working tree and staged diffs, staging files, creating local commits, and browsing a commit graph of the last 100 commits across local branches.

Requires macOS with Git available at /usr/bin/git, Node.js and Rust.

```sh
npm install
npm run dev
```

Choose **Open repository** and select a local Git working tree. Natalie uses your repository’s Git configuration and commit hooks.

Use **Repositories** to reopen a recent working tree or **Clone** to clone an HTTPS or SSH Git URL into a new folder. Clone uses the credentials already configured for Git and does not open a terminal credential prompt.
