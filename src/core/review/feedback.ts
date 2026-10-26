import { moveNumberFromFenBefore, formatSan, formatLine, type NotationStyle } from '../chess/notation';
import type { Feedback, FeedbackMove, FeedbackStyle } from './types';

export const PAUL = 'Paul aurait trouvé';

const QUIPS: Record<FeedbackStyle, string[]> = {
  sober: [],
  encouraging: [
    'Chaque erreur corrigée aujourd’hui est un coup trouvé demain.',
    'C’est en ratant une position qu’on finit par ne plus jamais la rater.',
    'Tu y es presque : la répétition fera le reste.',
    'Pas de panique, c’est exactement pour ça qu’on révise.',
  ],
  humorous: [
    'Paul, lui, l’a vu en blitz… les yeux fermés.',
    'Même un dimanche matin sans café, Paul l’aurait trouvé.',
    'Paul ne dit rien. Paul sourit.',
    'Quelque part, Paul secoue doucement la tête.',
    'Paul n’a pas eu besoin d’indice. Juste comme ça.',
    'Paul a déjà rangé les pièces et commandé un croissant.',
  ],
  competitive: [
    'Paul prend un point d’avance.',
    'Paul mène au score. Égalise vite.',
    'Paul inscrit ça dans son carnet de victoires.',
    'Paul : 1 — Toi : 0 sur cette position.',
  ],
};

const TITLES: Record<FeedbackStyle, string> = {
  sober: `${PAUL}.`,
  encouraging: `${PAUL} — et toi, la prochaine fois`,
  humorous: `${PAUL} 😏`,
  competitive: `${PAUL}. ⚔️`,
};

const CORRECT_TITLES: Record<FeedbackStyle, string[]> = {
  sober: ['Correct'],
  encouraging: ['Bien joué !', 'Exactement ça !', 'Parfait !'],
  humorous: ['Paul est fier de toi', 'Même Paul n’aurait pas fait mieux', 'Propre.'],
  competitive: ['+1 pour toi', 'Point marqué', 'Imparable'],
};

function pick<T>(list: T[], seed: string): T | undefined {
  if (!list.length) return undefined;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return list[Math.abs(h) % list.length];
}

export function moveLabelFrom(fenBefore: string, san: string, style: NotationStyle): string {
  const { moveNumber, color } = moveNumberFromFenBefore(fenBefore);
  return `${moveNumber}${color === 'w' ? '.' : '...'}${formatSan(san, style)}`;
}

export function fbMove(fenBefore: string, san: string, uci: string, style: NotationStyle): FeedbackMove {
  return { san, uci, label: moveLabelFrom(fenBefore, san, style) };
}

function listLabels(moves: FeedbackMove[]): string {
  if (moves.length === 1) return moves[0].label;
  return `${moves[0].label} (ou ${moves
    .slice(1)
    .map((m) => m.label)
    .join(', ')})`;
}

export interface ErrorFeedbackInput {
  style: FeedbackStyle;
  notation: NotationStyle;
  fenBefore: string;
  played: { san: string; uci: string };
  expected: FeedbackMove[];
  /** Suite de la ligne de référence après le coup attendu (SAN), avec la FEN après le coup attendu. */
  continuation?: { fen: string; sans: string[] };
  variationName?: string;
  explanation?: string;
  severity?: Feedback['severity'];
  graded: boolean;
  seed: string;
  cardId?: string;
}

/** Retour « Paul aurait trouvé » pour un coup légal absent du répertoire étudié. */
export function errorFeedback(i: ErrorFeedbackInput): Feedback {
  const played = fbMove(i.fenBefore, i.played.san, i.played.uci, i.notation);
  const cont = i.continuation && i.continuation.sans.length ? formatLine(i.continuation.sans, i.continuation.fen, i.notation) : undefined;
  return {
    kind: 'error',
    title: TITLES[i.style],
    message: `Tu as joué ${played.label}, mais ton répertoire prévoit ${listLabels(i.expected)}.`,
    played,
    expected: i.expected,
    referenceLine: cont ? `La ligne de référence continue avec ${cont}.` : 'C’est la fin de la ligne de référence.',
    variationName: i.variationName,
    explanation: i.explanation
      ? i.explanation
      : 'Aucune explication dans ton PGN pour ce coup : le coup attendu est simplement celui de ton répertoire.',
    severity: i.severity,
    quip: pick(QUIPS[i.style], i.seed),
    priorityNote: i.graded
      ? 'Cette position est ajoutée à tes révisions prioritaires.'
      : 'Session non notée : ta progression n’est pas modifiée.',
    cardId: i.cardId,
  };
}

export function correctFeedback(style: FeedbackStyle, played: FeedbackMove, seed: string, explanation?: string, cardId?: string): Feedback {
  return {
    kind: 'correct',
    title: pick(CORRECT_TITLES[style], seed) ?? 'Correct',
    message: `${played.label} est bien le coup de ton répertoire.`,
    played,
    explanation,
    cardId,
  };
}

export function alternativeFollowedFeedback(played: FeedbackMove, reference: FeedbackMove, variationName?: string, cardId?: string): Feedback {
  return {
    kind: 'correct',
    title: 'Autre coup de ta sélection',
    message: `${played.label} fait aussi partie des variantes sélectionnées (la ligne suivie prévoyait ${reference.label}). On continue dans cette variante.`,
    played,
    expected: [reference],
    variationName,
    cardId,
  };
}

export function strictAlternativeFeedback(played: FeedbackMove, policy: 'strict' | 'main'): Feedback {
  return {
    kind: policy === 'main' ? 'notMain' : 'alternative',
    title: policy === 'main' ? 'Bonne alternative, mais…' : 'Coup valide, autre variante',
    message:
      policy === 'main'
        ? `${played.label} est dans ta sélection, mais cette session révise les coups principaux. Joue le coup principal (sans pénalité).`
        : `${played.label} est dans ta sélection, mais la ligne étudiée continue avec un autre coup. Essaie encore (sans pénalité).`,
    played,
  };
}

export function outOfSelectionFeedback(played: FeedbackMove, where?: string): Feedback {
  return {
    kind: 'outOfSelection',
    title: 'Dans ton répertoire, hors sélection',
    message: `${played.label} existe dans ton répertoire${where ? ` (${where})` : ''}, mais cette variante n’est pas sélectionnée pour la session. Joue un coup des lignes choisies (sans pénalité).`,
    played,
  };
}

export function timeoutFeedback(expected: FeedbackMove[], graded: boolean, cardId?: string): Feedback {
  return {
    kind: 'timeout',
    title: 'Temps écoulé ⏱',
    message: `Le coup attendu était ${listLabels(expected)}.`,
    expected,
    priorityNote: graded ? 'Cette position est ajoutée à tes révisions prioritaires.' : undefined,
    cardId,
  };
}

export function revealedFeedback(expected: FeedbackMove[], explanation?: string, cardId?: string): Feedback {
  return {
    kind: 'revealed',
    title: 'Solution',
    message: `Ton répertoire joue ${listLabels(expected)}. Rejoue-le pour continuer.`,
    expected,
    explanation,
    cardId,
  };
}

export function learnShowFeedback(expected: FeedbackMove[], explanation?: string, cardId?: string): Feedback {
  return {
    kind: 'learnShow',
    title: 'À retenir',
    message: `Dans cette position, ton répertoire joue ${listLabels(expected)}. Joue-le sur l’échiquier.`,
    expected,
    explanation,
    cardId,
  };
}

export function lineCompleteFeedback(correct: number, questions: number, name?: string): Feedback {
  return {
    kind: 'lineComplete',
    title: 'Ligne terminée',
    message: questions
      ? `${correct}/${questions} coup${questions > 1 ? 's' : ''} trouvé${correct > 1 ? 's' : ''} du premier coup.`
      : 'Aucune question dans cette ligne pour ta couleur.',
    variationName: name,
  };
}
