# Contributing to byegl

Thank you for your interest in contributing to byegl! This document provides guidelines and information to help you get started.

## Project Overview

byegl is a monorepo, consisting of the following packages:

- `packages/byegl/` - The main library, changes to behavior are made here
- `apps/docs/` - Documentation site built with Astro, along with various examples demonstrating WebGL/WebGPU interoperability

## Development Setup

### Prerequisites

- Node.js 22.x or later
- pnpm 10.x or later

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/software-mansion/byegl.git
   cd byegl
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Start development:
   ```bash
   pnpm dev
   ```

## Development Workflow

### Available Scripts

- `pnpm dev` - Start development server for the docs, which automatically pulls in the local `byegl` package from source
- `pnpm test:ci` - Run all tests that can run in CI (style, node, types)
- `pnpm test:node` - Run Node.js tests
- `pnpm test:browser` - Run browser tests
- `pnpm test:style` - Run linting and formatting checks
- `pnpm test:types` - Run TypeScript type checking
- `pnpm fix` - Auto-fix linting and formatting issues

Before submitting a PR, ensure all checks pass:
```bash
pnpm test:ci
```

## Contributing Guidelines

### Issues

- Use GitHub issues to report bugs or request features
- Provide clear reproduction steps for bugs
- Include browser/OS information when relevant
- Check existing issues before creating new ones

### Pull Requests

1. Fork the repository
2. Create a branch: `git checkout -b your-change`
3. Make your changes
4. Verify locally: `pnpm test:ci`
5. Commit your changes with clear, descriptive messages
6. Push to your fork
7. Create a Pull Request on GitHub

### Commit Messages

Follow conventional commit format:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Test additions/updates
- `chore:` - Maintenance tasks

Thank you for contributing to byegl! 🎉
