
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
