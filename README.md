# Natalie

Natalie is a macOS Git client for reviewing diffs, staging changes, creating commits, and browsing a commit graph across local branches.

![Natalie showing the commit graph, commit metadata, and a file diff for a sample repository](docs/images/history.png)

## Download

Get the Apple Silicon DMG from [GitHub Releases](https://github.com/duckfollow/natalie/releases/latest). The build has no Developer ID signature or Apple notarization. Natalie uses Git at `/usr/bin/git`.

## Using Natalie

- Choose **Open repo** to open a local working tree. Natalie uses your repository’s Git configuration and commit hooks.
- Open **History** to browse the commit graph, or use **Search** to find commits by subject, author, hash, or ref. Both views load more commits as you scroll.
- Use **Repositories** to reopen a recent working tree or **Clone** to clone an HTTPS or SSH Git URL. Clone uses the credentials configured for Git and does not open a terminal credential prompt.

## Run from source

Install Node.js and Rust on macOS, then run:

```sh
npm install
npm run dev
```
