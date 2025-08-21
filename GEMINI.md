
# GEMINI.md

This file provides a comprehensive overview of the project for the Gemini AI agent.

## Project Overview

This is a mini-program full-stack solution based on `x-dev-uni` and `nitro cloudflare worker`. It serves as a template for building mini-programs with a serverless backend. The project is a monorepo managed with pnpm workspaces.

## Tech Stack

- **Frontend:** Vue.js, uni-app (for mini-programs), vite, tailwindcss, unocss, pinia (state management), vue-i18n.
- **Backend:** Nitro (serverless framework), Cloudflare Workers, Drizzle ORM.
- **Monorepo:** pnpm workspaces.
- **Linting/Formatting:** eslint, stylelint.
- **Testing:** vitest.
- **Build:** unbuild, vite.
- **Language:** TypeScript.
- **Database:** Cloudflare D1.
- **Other:** Telegram Bot (grammy), JWT (jose), Data Validation (zod), AI (OpenAI, Deepseek).

## Codebase Structure

- **`apps`**: Contains the applications.
  - **`congrong-private-api`**: The backend application (Nitro/Cloudflare Worker).
  - **`congrong-private-wx`**: The frontend application (uni-app for WeChat mini-program).
- **`packages`**: Contains reusable packages.
  - **`@x-dev-uni/logger`**: A logging utility.
  - **`@x-dev-uni/preset`**: An `unocss` preset.
  - **`@x-dev-uni/ui`**: A Vue 3 component library.
  - **`@x-dev-uni/utils`**: A utility library.
  - **`x-dev-uni`**: A meta-package that combines the other packages.
- **`docs`**: Contains the documentation.
- **`examples`**: Contains example projects.

## Building and Running

### Getting Started

1.  **Install dependencies:**
    ```bash
    pnpm install
    ```

2.  **Run the backend development server:**
    ```bash
    pnpm --filter=congrong-private-api dev
    ```

3.  **Run the frontend development server:**
    ```bash
    pnpm --filter=congrong-private-wx dev
    ```

### Other useful commands

-   **Linting:**
    ```bash
    pnpm lint
    ```

-   **Building for production:**
    ```bash
    pnpm build
    ```

-   **Database migration:**
    ```bash
    pnpm --filter=congrong-private-api migrate:db
    ```

## Development Conventions

The project uses `@icebreakers/eslint-config` and `@icebreakers/stylelint-config` to enforce code style. This means the project follows the coding style of the `icebreakers` community. The `preinstall` script in the root `package.json` enforces the use of `pnpm` as the package manager.
