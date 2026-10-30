/**
 * Mine Antarctica on Boxity: its hosting id (also its slug) and the leaderboards it
 * declares. The client declares the boards (that's what shows Boxity's trophy button);
 * the server reports the scores, from state it owns.
 */
export const GAME_ID = 'mine-antarctica'

export const BOXITY_BOARDS = [
  { id: 'crystals', label: 'Most crystals mined', order: 'desc', mode: 'best', format: 'compact', reset: 'none' },
]
