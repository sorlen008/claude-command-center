// Curated knowledge base for all known MCPs, plugins, and projects
// Keyed by entity name for O(1) lookup during scanning

export type MCPCategory = "data" | "dev-tools" | "integration" | "ai" | "browser" | "productivity";
export type PluginCategory = "browser" | "dev-tools" | "integration" | "productivity" | "ai" | "code-quality" | "lsp";

export interface MCPCatalogEntry {
  description: string;
  category: MCPCategory;
  capabilities: string[];
  website?: string;
}

export interface PluginCatalogEntry {
  description: string;
  category: PluginCategory;
}

export const MCP_CATALOG: Record<string, MCPCatalogEntry> = {
  "context7": {
    description: "Retrieves up-to-date documentation and code examples for any library",
    category: "dev-tools",
    capabilities: [
      "Resolve library IDs from package names",
      "Query library documentation with topic filtering",
      "Fetch code examples and API references",
    ],
    website: "https://context7.com",
  },
  "findash": {
    description: "Finance dashboard MCP with PostgreSQL database access",
    category: "data",
    capabilities: [
      "Query financial overview and KPIs",
      "Search transactions and spending by category",
      "View accounts, assets, and portfolio data",
      "Budget tracking and subscription management",
    ],
  },
  "21st-dev": {
    description: "AI-powered UI component builder using 21st.dev design system",
    category: "dev-tools",
    capabilities: [
      "Generate React components from natural language descriptions",
      "Search for component inspiration and design patterns",
      "Refine existing components with AI suggestions",
      "Search for logos and brand assets",
    ],
    website: "https://21st.dev",
  },
  "figma": {
    description: "Connects to Figma for design file access and inspection",
    category: "integration",
    capabilities: [
      "Read Figma design files and components",
      "Extract design tokens and styles",
      "Inspect layouts and generate code from designs",
    ],
    website: "https://figma.com",
  },
  "google-workspace": {
    description: "Google Workspace integration for Sheets, Drive, and Tasks",
    category: "productivity",
    capabilities: [
      "Read and write Google Sheets data",
      "Manage Google Drive files and folders",
      "Create and manage Google Tasks",
    ],
  },
  "playwright": {
    description: "Browser automation via Playwright, connects via Chrome DevTools Protocol",
    category: "browser",
    capabilities: [
      "Navigate pages, click elements, fill forms",
      "Take screenshots and snapshots of page state",
      "Execute JavaScript in browser context",
      "Manage tabs and handle dialogs",
    ],
  },
  "asana": {
    description: "Project management integration with Asana workspaces",
    category: "productivity",
    capabilities: [
      "Create and manage tasks and projects",
      "Track project progress and assignees",
      "Query workspaces and team data",
    ],
    website: "https://asana.com",
  },
  "firebase": {
    description: "Firebase backend services integration (Firestore, Auth, Storage)",
    category: "data",
    capabilities: [
      "Query and manage Firestore documents",
      "Manage Firebase Authentication users",
      "Access Firebase Storage files",
    ],
  },
  "github": {
    description: "GitHub API integration for repos, issues, PRs, and actions",
    category: "dev-tools",
    capabilities: [
      "Manage repositories, branches, and commits",
      "Create and manage issues and pull requests",
      "Query GitHub Actions workflows and runs",
      "Access user and organization data",
    ],
    website: "https://github.com",
  },
  "gitlab": {
    description: "GitLab API integration for repos, pipelines, and merge requests",
    category: "dev-tools",
    capabilities: [
      "Manage repositories and merge requests",
      "Query CI/CD pipeline status",
      "Access project issues and milestones",
    ],
    website: "https://gitlab.com",
  },
  "greptile": {
    description: "AI-powered codebase search and understanding",
    category: "ai",
    capabilities: [
      "Semantic search across entire codebases",
      "Answer questions about code architecture",
      "Find relevant code snippets by intent",
    ],
    website: "https://greptile.com",
  },
  "laravel-boost": {
    description: "Laravel development tools and code generation",
    category: "dev-tools",
    capabilities: [
      "Generate Laravel models, controllers, and migrations",
      "Scaffold API endpoints and routes",
      "Create test files and fixtures",
    ],
  },
  "linear": {
    description: "Linear project management integration for issues and cycles",
    category: "productivity",
    capabilities: [
      "Create and manage issues and projects",
      "Track sprint cycles and progress",
      "Query team workloads and assignments",
    ],
    website: "https://linear.app",
  },
  "serena": {
    description: "AI coding assistant with deep code understanding",
    category: "ai",
    capabilities: [
      "Analyze code structure and dependencies",
      "Suggest refactoring and improvements",
      "Generate code from specifications",
    ],
  },
  "slack": {
    description: "Slack workspace integration for messaging and channels",
    category: "integration",
    capabilities: [
      "Send and read messages in channels",
      "Search message history",
      "Manage channel memberships",
    ],
    website: "https://slack.com",
  },
  "stripe": {
    description: "Stripe payment platform integration",
    category: "data",
    capabilities: [
      "Query customers, charges, and subscriptions",
      "Manage payment intents and invoices",
      "Access financial reports and balances",
    ],
    website: "https://stripe.com",
  },
  "supabase": {
    description: "Supabase backend integration (Postgres, Auth, Storage, Edge Functions)",
    category: "data",
    capabilities: [
      "Query and manage Postgres database tables",
      "Manage authentication users and sessions",
      "Access storage buckets and files",
      "Deploy and manage Edge Functions",
    ],
    website: "https://supabase.com",
  },
  "example-server": {
    description: "Example MCP server for testing and development reference",
    category: "dev-tools",
    capabilities: [
      "Demonstrates MCP server protocol implementation",
      "Provides sample tools for testing",
    ],
  },
  "postgres": {
    description: "Direct PostgreSQL database access for running queries",
    category: "data",
    capabilities: [
      "Execute SQL queries against PostgreSQL databases",
      "Query table schemas and metadata",
      "Read and analyze database content",
    ],
  },
  "claude_ai_Gmail": {
    description: "Gmail integration for reading and drafting emails",
    category: "productivity",
    capabilities: [
      "Search and read email messages and threads",
      "Create and manage email drafts",
      "List labels and get profile info",
    ],
  },
  "claude_ai_Google_Calendar": {
    description: "Google Calendar integration for events and scheduling",
    category: "productivity",
    capabilities: [
      "List and manage calendar events",
      "Find free time and meeting slots",
      "Create, update, and respond to events",
    ],
  },
  "browsermcp": {
    description: "Browser automation and web interaction via Chrome DevTools Protocol",
    category: "browser",
    capabilities: [
      "Navigate web pages and take screenshots",
      "Click, type, and interact with page elements",
      "Read page content and console logs",
    ],
  },
  "nicora-desk": {
    description: "Finance dashboard with accounts, transactions, and analytics",
    category: "data",
    capabilities: [
      "Query financial overview and KPIs",
      "Manage accounts, transactions, and budgets",
      "Track net worth, assets, and spending",
    ],
  },
  "stitch": {
    description: "Google Stitch AI-powered UI generation from text prompts",
    category: "ai",
    capabilities: [
      "Generate full HTML pages from text descriptions",
      "Edit and refine existing screen designs",
      "Create design variants with controlled creativity",
    ],
    website: "https://developers.google.com/stitch",
  },
  "discord": {
    description: "Discord messaging platform integration",
    category: "integration",
    capabilities: [
      "Send and read Discord messages",
      "Manage channels and servers",
      "Interact with Discord communities",
    ],
  },
  "telegram": {
    description: "Telegram messaging platform integration",
    category: "integration",
    capabilities: [
      "Send and read Telegram messages",
      "Manage bot interactions and commands",
      "Access chat history and media",
    ],
  },
  "fakechat": {
    description: "Mock chat server for testing and development",
    category: "dev-tools",
    capabilities: [
      "Simulate chat interactions for testing",
      "Provide mock responses for development",
    ],
  },
};

export const PLUGIN_CATALOG: Record<string, PluginCatalogEntry> = {
  // Dev tools
  "claude-code-github": {
    description: "GitHub integration for pull requests, issues, and code review",
    category: "dev-tools",
  },
  "claude-code-jira": {
    description: "Jira project management and issue tracking integration",
    category: "dev-tools",
  },
  "context7": {
    description: "Library documentation and code examples lookup",
    category: "dev-tools",
  },
  "serena": {
    description: "AI coding assistant with deep code understanding",
    category: "ai",
  },
  "greptile": {
    description: "AI-powered semantic codebase search",
    category: "ai",
  },
  "21st-dev-magic-mcp": {
    description: "AI-powered React component builder",
    category: "dev-tools",
  },
  "figma-developer-mcp": {
    description: "Figma design file access and code generation",
    category: "dev-tools",
  },
  // Integration
  "claude-code-slack": {
    description: "Slack messaging and channel management",
    category: "integration",
  },
  "supabase": {
    description: "Supabase backend services (Postgres, Auth, Storage)",
    category: "integration",
  },
  "firebase-mcp": {
    description: "Firebase backend services integration",
    category: "integration",
  },
  "stripe-mcp": {
    description: "Stripe payment platform integration",
    category: "integration",
  },
  "asana-mcp": {
    description: "Asana project management integration",
    category: "integration",
  },
  "linear-mcp": {
    description: "Linear issue tracking and project management",
    category: "integration",
  },
  "laravel-boost": {
    description: "Laravel development tools and scaffolding",
    category: "dev-tools",
  },
  // Browser
  "playwright-mcp": {
    description: "Browser automation via Playwright for testing and scraping",
    category: "browser",
  },
  // Productivity
  "google-workspace": {
    description: "Google Sheets, Drive, and Tasks integration",
    category: "productivity",
  },
  // LSP plugins
  "clangd-lsp": {
    description: "C/C++ language server (clangd) for code intelligence",
    category: "lsp",
  },
  "pyright-lsp": {
    description: "Python language server (Pyright) for type checking and completions",
    category: "lsp",
  },
  "typescript-lsp": {
    description: "TypeScript/JavaScript language server for type-aware editing",
    category: "lsp",
  },
  "rust-analyzer-lsp": {
    description: "Rust language server (rust-analyzer) for code intelligence",
    category: "lsp",
  },
  "gopls-lsp": {
    description: "Go language server (gopls) for code navigation and refactoring",
    category: "lsp",
  },
  "lua-lsp": {
    description: "Lua language server for code intelligence",
    category: "lsp",
  },
  "ruby-lsp": {
    description: "Ruby language server for code intelligence",
    category: "lsp",
  },
  "java-lsp": {
    description: "Java language server (Eclipse JDT) for code intelligence",
    category: "lsp",
  },
  "kotlin-lsp": {
    description: "Kotlin language server for code intelligence",
    category: "lsp",
  },
  "csharp-lsp": {
    description: "C# language server (OmniSharp) for code intelligence",
    category: "lsp",
  },
  "swift-lsp": {
    description: "Swift language server (SourceKit-LSP) for code intelligence",
    category: "lsp",
  },
  "yaml-lsp": {
    description: "YAML language server for validation and schema support",
    category: "lsp",
  },
};

