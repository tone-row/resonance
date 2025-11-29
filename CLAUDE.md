# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Resonance** is a real-time collaborative statement voting application built with Next.js 16 and PartyKit/PartyServer. The app enables groups to:
- Create and vote on statements (agree/disagree)
- Display statements with unanimous agreement in an animated flowing text display
- Maintain real-time synchronization across all connected participants

## Development Commands

### Local Development
```bash
npm run dev          # Runs both Next.js (port 3000) and Wrangler (CloudFlare Workers dev server)
npm run dev:next     # Next.js only
npm run dev:party    # Wrangler only (WebSocket server)
```

### Testing & Type Checking
```bash
npm run test         # Run all tests with Bun
npm run typecheck    # TypeScript type checking without emitting files
npm run lint         # ESLint with Next.js config
```

### Build & Deployment
```bash
npm run build                # Build Next.js for production
npm run partykit:deploy      # Deploy WebSocket server to CloudFlare Workers
```

## Architecture

### Real-time Communication Layer

The application uses **dual WebSocket server implementations**:

1. **Production (party/index.ts)**: PartyServer on CloudFlare Workers
   - Uses `partyserver` library with Durable Objects
   - Class-based: `ResonanceServer implements PartyServer`
   - Configured in `wrangler.toml` with hibernation enabled
   - Deploys to CloudFlare Workers edge network

2. **Development (party/server.ts)**: PartyKit local server
   - Uses `partykit` library
   - Runs on `127.0.0.1:1999` (configured in partykit.json)
   - Alternative implementation with simpler file-based storage

**Environment Configuration:**
- `NEXT_PUBLIC_PARTYKIT_HOST` determines which server to connect to
  - Development: `127.0.0.1:1999`
  - Production: CloudFlare Workers endpoint

### WebSocket Message Protocol

All messages are JSON with `type` field for routing:

**Client → Server:**
- `{ type: "get_session" }` - Request current session state
- `{ type: "add_statement", payload: { text, createdBy, present } }` - Add new statement
- `{ type: "vote_response", payload: { statementIndex, userId, agree } }` - Submit vote

**Server → Client:**
- `{ type: "session_state", session: {...} }` - Broadcast updated state to all clients

### Session State Management (lib/session.ts)

The core business logic uses a **reducer pattern** with three action types:

1. **ADD_STATEMENT**: Adds statement, sets as "live" if none exists, auto-votes agree for creator
2. **RESPOND_TO_STATEMENT**: Records vote, checks if resolved, selects next live statement
3. **UPDATE_UNRESOLVED_STATEMENTS**: Manages user presence in unresolved statements (handles joins/disconnects)

**Session Structure:**
```typescript
Session {
  statements: Statement[]
  liveStatementIndex: number | null  // Currently displayed statement for voting
}

Statement {
  text: string
  createdBy: userId
  present: userId[]           // Users who must vote
  responses: {userId: boolean}  // true=agree, false=disagree
}
```

**Key Logic:**
- Statement is "resolved" when all `present` users have voted
- "Agreed" statements: resolved AND all responses are `true`
- Live statement selection prioritizes creators with fewer resolved statements (fairness algorithm)

### User Management

**User Identity:**
- Generated client-side via `useUserId()` hook
- Persists in `localStorage` using `nanoid()`
- No authentication system - anonymous collaboration

**Presence Handling:**
- 5-second grace period on disconnect prevents vote loss during page refreshes
- Users are added to unresolved statements when joining an active room
- Past votes are removed if user disconnects permanently

## Frontend Architecture

### Directory Structure
```
/app                 - Next.js App Router (pages & layouts)
  /room/[roomId]    - Dynamic room page (main voting UI)
  page.tsx          - Home page (create session)
  layout.tsx        - Root layout with fonts

/components/ui      - shadcn/ui component library (30+ components)
/hooks              - Custom React hooks (useUserId, use-mobile)
/lib                - Core business logic (session reducer, utilities)
```

### Styling System

- **Tailwind CSS v4** with custom OKLch color palette
- **CSS custom properties** defined in `app/globals.css`
- **shadcn/ui** for consistent component design
- **Dark mode** support via `next-themes`
- Import aliases: `@/` prefix for all imports (tsconfig.json)

### Animation Patterns (Framer Motion)

**Live Statement Entry:**
- Entry: fade in + slide up + blur removal + scale up
- Duration: 1.2-1.4s with custom easing
- Exit: reverse animation when statement resolves

**Agreed Statements:**
- Staggered animations (0.1s delay per statement)
- Complex easing for smooth flowing text effect
- Separate filter animations (blur, brightness)
- Duration: 2.5s for elegant appearance

## Testing

Tests use **Bun test runner** and are located in `/lib/*.test.ts`:
- `session.test.ts` - Core reducer logic and state transitions
- `liveStatement.test.ts` - Live statement selection algorithm

Run single test file:
```bash
bun test lib/session.test.ts
```

## CloudFlare Workers Deployment

The PartyServer is deployed as a CloudFlare Workers Durable Object:

**Configuration (wrangler.toml):**
- Worker name: `resonance-party`
- Entry: `party/index.ts`
- Durable Object binding: `ResonanceServer`
- NodeJS compatibility enabled

**Deploy:**
```bash
npm run partykit:deploy
```

After deployment, update `NEXT_PUBLIC_PARTYKIT_HOST` environment variable in Vercel to point to the Workers endpoint.

## Common Development Patterns

**Adding a new statement action:**
1. Add action type to `SessionAction` union in `lib/session.ts`
2. Implement case in `sessionReducer()` switch statement
3. Add message handler in both `party/index.ts` and `party/server.ts`
4. Update client to send new message type via `socket.send()`

**Adding a new UI component:**
1. Use shadcn/ui CLI if component exists in library
2. Import from `@/components/ui/[component-name]`
3. Apply custom variants in component file if needed (see Button green/red variants)

**Modifying session state structure:**
1. Update type definitions in `lib/session.ts`
2. Update reducer logic to handle new fields
3. Add tests in `lib/session.test.ts`
4. Update both WebSocket server implementations

## Important Notes

- The app uses **React 19.2.0** - be aware of latest React patterns and breaking changes
- **Room IDs** are generated with `nanoid()` - collision-resistant but not cryptographically secure
- **No authentication** - all sessions are publicly accessible via room URL
- **State is ephemeral** - sessions exist only in Durable Object memory (no database)
- When modifying animations, test on multiple devices as Framer Motion performance varies
- The session reducer is **pure** - never mutate state directly, always return new objects
