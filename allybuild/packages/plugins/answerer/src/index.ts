/**
 * Answer ask_user_question from AllyBuild's task drawer.
 *
 * Registers an answerer on the `user-questions/request` waterfall. Without an
 * answerer the ask fails closed (NO_PROVIDER) and the model retries the tool
 * in a loop until the turn ceiling — task sessions have no browser UI, so the
 * platform IS the user. Flow:
 *
 *   ask() → POST /internal/dsh-question-register (task flips to
 *   pending_approval via the progress-sync ask_user line) → long-poll
 *   /internal/dsh-answer-poll until the user answers in the drawer →
 *   {answers: [{id, selected: [], custom}]} feeds back into the agent loop as
 *   an ordinary tool result, and the SAME turn continues to completion.
 *
 * If the wait window elapses with no answer, fall through to next() so the
 * model sees the closed failure and can proceed (worker parks the task in
 * pending_approval; feedback then takes the new-turn path).
 *
 * @module @deepseek-ai/dsh-allybuild-answerer
 */

import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Composition entry. */
export interface Config {
  /** AllyBuild internal answer endpoint root (register + poll). */
  url: string
  /** HMAC-SHA256(agentId, JWT_SECRET) hex, issued by the driver. */
  token: string
  /** AllyBuild ProjectAgent id the payload is attributed to. */
  agentId: string
}

/** Structural subset of AskUserQuestionItem the answerer needs. */
interface QuestionItem {
  id?: unknown
  question?: unknown
}

/** Structural subset of the waterfall request. */
interface AskRequest {
  questions?: unknown
  signal?: { aborted?: boolean }
}

/** User answer delivered by the platform. */
export interface PlatformAnswer {
  custom?: string
}

/** How long one ask() waits for the user before failing closed. */
const WAIT_WINDOW_MS = 30 * 60 * 1000
/** One long-poll cycle (backend BLPOP timeout + slack). */
const POLL_CYCLE_S = 26

/** Minimal structural face of the cordis host Context. */
interface AnswererContext {
  on(
    event: 'user-questions/request',
    listener: (request: AskRequest, next: () => Promise<unknown>) => Promise<unknown>,
    options?: { global?: boolean },
  ): unknown
}

function questionList(raw: unknown): QuestionItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const items: QuestionItem[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    items.push(item as QuestionItem)
  }
  return items.length > 0 ? items : undefined
}

export class AllybuildAnswerer extends Service {
  static Config: z<Config> = z.object({
    url: z.string().default(''),
    token: z.string().default(''),
    agentId: z.string().default(''),
  })

  constructor(ctx: AnswererContext, config: Config) {
    super(ctx as never, 'allybuildAnswerer')
    if (!config.url || !config.token || !config.agentId) return

    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${config.token}`,
    }

    const register = (questions: QuestionItem[]): Promise<void> =>
      fetch(`${config.url}/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agentId: config.agentId,
          questions: questions.map((q) => ({
            id: typeof q.id === 'string' ? q.id : '',
            question: typeof q.question === 'string' ? q.question : '',
          })),
        }),
        signal: AbortSignal.timeout(10_000),
      }).then(
        () => undefined,
        (reason: unknown) => {
          console.warn('[allybuild-answerer] register failed:', reason)
        },
      )

    const pollOnce = async (): Promise<PlatformAnswer | null> => {
      try {
        const resp = await fetch(
          `${config.url}/poll?agentId=${encodeURIComponent(config.agentId)}&wait=${POLL_CYCLE_S - 1}`,
          { headers, signal: AbortSignal.timeout(POLL_CYCLE_S * 1000) },
        )
        if (!resp.ok) return null
        const data = (await resp.json()) as { answer?: PlatformAnswer | null }
        return data.answer ?? null
      } catch {
        return null
      }
    }

    // global: true — the ask dispatches on the task's agent scope; a root
    // registration only joins that waterfall with the global flag.
    ctx.on('user-questions/request', async (request, next) => {
      const questions = questionList(request?.questions)
      if (questions === undefined) return next()
      await register(questions)
      const deadline = Date.now() + WAIT_WINDOW_MS
      while (Date.now() < deadline) {
        if (request.signal?.aborted === true) break
        const answer = await pollOnce()
        if (answer !== null) {
          const custom = typeof answer.custom === 'string' ? answer.custom : ''
          return {
            answers: questions.map((q) => ({
              id: typeof q.id === 'string' ? q.id : '',
              selected: [] as string[],
              ...(custom ? { custom } : {}),
            })),
          }
        }
      }
      // Window elapsed or aborted — fail closed like an unanswered request.
      return next()
    }, { global: true })
  }
}

export default AllybuildAnswerer
