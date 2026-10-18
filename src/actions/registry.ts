// Реестр действий. Новое действие = файл в actions/ + register() в actions/index.ts.

import type { ActionResult } from '../protocol'

export interface Action {
  name: string
  run(params: Record<string, unknown>): Promise<ActionResult>
}

const actions: Record<string, Action> = {}

export function register(action: Action): void {
  actions[action.name] = action
}

export function actionNames(): string[] {
  return Object.keys(actions)
}

export async function runAction(
  name: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const action = actions[name]
  if (!action) return { ok: false, error: 'unknown_action' }
  try {
    return await action.run(params || {})
  } catch (e) {
    console.error('AlicaConnector', name, e)
    return { ok: false, error: 'internal' }
  }
}
