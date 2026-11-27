# Installation

## Install

Eaglediff needs Node.js **22.12.0 or newer** and Chrome or Chromium. It uses the
browser already installed on your system; installing Eaglediff does not
download one. See [Prerequisites](#prerequisites) for installing and checking
these tools.

```bash
npm install -g eaglediff
eaglediff --version
```

### From a source checkout

For development, or to try unreleased changes, clone the repository and install
it from inside its folder. This also needs Git and pnpm **9.0.0 or newer**.

```bash
git clone https://github.com/GiorgosK/EagleDiff.git eaglediff
cd eaglediff

# Install dependencies
pnpm install

# Install the eaglediff command globally from this folder
pnpm add -g "$PWD"
```

`$PWD` means the current folder. The global installation lets you run
`eaglediff` from anywhere.

### Supported systems

Eaglediff is developed and tested on Linux. It looks for Chrome or Chromium in
the usual places on Linux, macOS and Windows, but macOS and Windows are
**untested**. If the browser is not found, set `CHROME_BIN` (or
`PUPPETEER_EXECUTABLE_PATH`) to its full path. Reports and results from these
systems are welcome.

Screenshots depend on the operating system, browser version and installed
fonts. Take references and run tests on the same kind of machine, for example
the same CI image, or every page may differ slightly.

## Prerequisites

Install these before installing Eaglediff. The commands below are for Linux
with Bash or Zsh.

| Tool | Minimum / supported version | Recommended setup |
| --- | --- | --- |
| Node.js | **22.12.0**, required by the installed Puppeteer dependency. | **22.19.0**, recorded in `.nvmrc`. |
| pnpm | **9.0.0**, which supports this repository's version 9 lockfile. | **11.17.0**, used for current development. |
| Chrome / Chromium | No verified minimum; use a browser supported by Puppeteer. | See the [compatibility table](https://pptr.dev/supported-browsers). |
| Git | No project-specific version requirement; used to clone the code. | A maintained version from your system's package manager. |

npm comes with Node; nvm is optional. See
[Puppeteer's requirements](https://pptr.dev/guides/system-requirements) for compatibility.

### Install missing tools

On Ubuntu/Debian, install Git and curl:

```bash
sudo apt update
sudo apt install git curl
```

Install [nvm using its official instructions](https://github.com/nvm-sh/nvm#installing-and-updating),
then open a new terminal. If nvm is already installed, skip that installation.
Install Node and [pnpm](https://pnpm.io/installation):

```bash
# Install and activate the project's recommended Node version
nvm install 22.19.0
nvm use 22.19.0

# Use it automatically in new terminals (changes your user's default Node)
nvm alias default 22.19.0

# Install the package manager under this Node version
npm install -g pnpm@11.17.0
```

For automatic Node selection, your shell must load nvm. Its installer normally
adds these lines to `~/.zshrc` or `~/.bashrc`; add them if missing:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

Install [Google Chrome](https://www.google.com/chrome/) or Chromium through your
system's package manager. Eaglediff uses your installed browser; `pnpm install`
does not download one.

### Verify before continuing

Open a **new terminal** and run these without first running `nvm use`:

```bash
git --version
node --version
npm --version
pnpm --version
google-chrome --version || chromium --version || chromium-browser --version
```

Each should print a version. If Node is missing, check nvm startup and its
default version. If pnpm is missing, reinstall it after activating Node.
For a browser elsewhere, set `CHROME_BIN` or `PUPPETEER_EXECUTABLE_PATH`
to its full executable path.
