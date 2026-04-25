/**
 * Situation Graph  evaluates the user's full context and decides
 * what action to take and what to say, without requiring voice input.
 *
 * This replaces the dumb "if lower.includes('yes')" transcript handler
 * with a graph of situations  actions.
 */

export type AppState = 'setup' | 'idle' | 'scanning' | 'scanned' | 'quantity' | 'added' | 'checkout' | 'paying';
export type InputMode = 'button' | 'voice' | null;

export interface ShopContext {
  appState: AppState;
  inputMode: InputMode;
  basketTotal: number;
  basketCount: number;
  balance: number | null;       // null = unknown
  productPrice: number | null;  // current scanned product price
  productName: string | null;
  allergens: string[];          // allergens in current product
  isPublicPlace: boolean;       // heuristic: checkout + button mode = likely public
}

export interface SituationAction {
  speak: string | null;         // null = stay silent
  autoAdvance: boolean;         // true = do the action without asking
  action: 'pay' | 'warn' | 'skip' | 'confirm' | 'listen' | 'none';
  urgency: 'high' | 'medium' | 'low';
}

//  Situation nodes

interface SituationNode {
  id: string;
  matches: (ctx: ShopContext) => boolean;
  priority: number; // higher = evaluated first
  resolve: (ctx: ShopContext) => SituationAction;
}

const SITUATIONS: SituationNode[] = [
  {
    id: 'payment_processing',
    priority: 100,
    matches: ctx => ctx.appState === 'paying',
    resolve: () => ({ speak: null, autoAdvance: false, action: 'none', urgency: 'high' }),
  },
  {
    id: 'basket_empty_checkout',
    priority: 90,
    matches: ctx => ctx.appState === 'checkout' && ctx.basketCount === 0,
    resolve: () => ({ speak: 'Je mandje is leeg. Scan eerst een product.', autoAdvance: true, action: 'skip', urgency: 'high' }),
  },
  {
    id: 'low_balance_critical',
    priority: 85,
    matches: ctx => ctx.appState === 'checkout' && ctx.balance !== null && ctx.balance < ctx.basketTotal,
    resolve: ctx => ({
      speak: `Waarschuwing: je saldo van ${ctx.balance!.toFixed(2)} euro is niet genoeg voor je mandje van ${ctx.basketTotal.toFixed(2)} euro.`,
      autoAdvance: false,
      action: 'warn',
      urgency: 'high',
    }),
  },
  {
    id: 'checkout_public_silent',
    // In checkout + button mode = likely surrounded by people, proceed silently
    priority: 80,
    matches: ctx => ctx.appState === 'checkout' && ctx.inputMode === 'button' && ctx.basketCount > 0 && (ctx.balance === null || ctx.balance >= ctx.basketTotal),
    resolve: ctx => ({
      speak: `Totaal ${ctx.basketTotal.toFixed(2)} euro. Druk om te betalen.`,
      autoAdvance: false,
      action: 'confirm',
      urgency: 'medium',
    }),
  },
  {
    id: 'checkout_voice',
    priority: 75,
    matches: ctx => ctx.appState === 'checkout' && ctx.inputMode === 'voice' && ctx.basketCount > 0,
    resolve: ctx => ({
      speak: `Je mandje is ${ctx.basketTotal.toFixed(2)} euro. Zeg betalen om door te gaan, of annuleren om terug te gaan.`,
      autoAdvance: false,
      action: 'listen',
      urgency: 'medium',
    }),
  },
  {
    id: 'allergen_warning',
    priority: 70,
    matches: ctx => ctx.appState === 'scanned' && ctx.allergens.length > 0,
    resolve: ctx => ({
      speak: `Let op: dit product bevat ${ctx.allergens.join(' en ')}. Wil je het toch toevoegen?`,
      autoAdvance: false,
      action: 'confirm',
      urgency: 'high',
    }),
  },
  {
    id: 'product_no_price',
    priority: 65,
    matches: ctx => ctx.appState === 'scanned' && ctx.productPrice === 0,
    resolve: ctx => ({
      speak: `Ik heb ${ctx.productName ?? 'een product'} gevonden maar kon de prijs niet bepalen. Wil je het toevoegen?`,
      autoAdvance: false,
      action: 'confirm',
      urgency: 'medium',
    }),
  },
  {
    id: 'product_scanned_normal',
    priority: 60,
    matches: ctx => ctx.appState === 'scanned' && (ctx.productPrice ?? 0) > 0 && ctx.allergens.length === 0,
    resolve: ctx => ({
      speak: `${ctx.productName}, ${ctx.productPrice!.toFixed(2)} euro. Toevoegen?`,
      autoAdvance: false,
      action: 'confirm',
      urgency: 'low',
    }),
  },
  {
    id: 'low_balance_idle_warning',
    priority: 55,
    matches: ctx => ctx.appState === 'idle' && ctx.balance !== null && ctx.balance < 10,
    resolve: ctx => ({
      speak: `Je saldo is laag: ${ctx.balance!.toFixed(2)} euro.`,
      autoAdvance: false,
      action: 'warn',
      urgency: 'medium',
    }),
  },
  {
    id: 'setup_initial',
    priority: 50,
    matches: ctx => ctx.appState === 'setup',
    resolve: () => ({
      speak: 'Welkom bij Shopper Buddy. Zeg knop of stem om je modus te kiezen.',
      autoAdvance: false,
      action: 'listen',
      urgency: 'low',
    }),
  },
];

//  Graph evaluator

/**
 * Evaluate the current context against all situation nodes.
 * Returns the highest-priority matching situation's action.
 */
export function evaluateSituation(ctx: ShopContext): SituationAction {
  const sorted = [...SITUATIONS].sort((a, b) => b.priority - a.priority);
  for (const node of sorted) {
    if (node.matches(ctx)) {
      const action = node.resolve(ctx);
      console.log(`[SituationGraph] MATCH: ${node.id}`, { ctx, action });
      return action;
    }
  }
  console.log('[SituationGraph] NO MATCH  returning none', ctx);
  return { speak: null, autoAdvance: false, action: 'none', urgency: 'low' };
}

function extractQuantity(transcript: string): number | null {
  const digitMatch = transcript.match(/\d+/);
  if (digitMatch) {
    const value = parseInt(digitMatch[0], 10);
    if (!isNaN(value) && value > 0) return value;
  }

  const wordMap: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    een: 1,
    twee: 2,
    drie: 3,
    vier: 4,
    vijf: 5,
    zes: 6,
    zeven: 7,
    acht: 8,
    negen: 9,
    tien: 10,
  };

  for (const [word, value] of Object.entries(wordMap)) {
    if (new RegExp(`\\b${word}\\b`).test(transcript)) return value;
  }

  return null;
}

function extractRemovalTarget(transcript: string): string | null {
  const removeIntent = /(remove|delete|take off|take out|drop|discard|haal|verwijder)/.test(transcript);
  if (!removeIntent) return null;

  let cleaned = transcript
    .replace(/^(i want to|please|can you|could you|would you|ik wil|wil je)\s+/g, '')
    .replace(/\b(remove|delete|take off|take out|drop|discard|haal|verwijder)\b/g, '')
    .replace(/\b(from|out of|off|my|the|uit|van|mijn|het)\b/g, ' ')
    .replace(/\b(basket|cart|mandje)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || null;
}

/**
 * Process a voice transcript in the context of the current situation.
 * Returns what action to take.
 */
export function processVoiceInput(
  transcript: string,
  ctx: ShopContext
): { action: string; qty?: number; productQuery?: string } {
  const t = transcript.toLowerCase().trim();
  const qty = extractQuantity(t);
  const removalTarget = extractRemovalTarget(t);
  console.log(`[SituationGraph] processVoiceInput  transcript: "${transcript}" | state: ${ctx.appState} | mode: ${ctx.inputMode}`);

  if (ctx.appState === 'setup') {
    if (t.includes('stem') || t.includes('voice') || t.includes('spraak')) return { action: 'set_voice' };
    if (t.includes('knop') || t.includes('button')) return { action: 'set_button' };
    return { action: 'repeat_setup' };
  }

  if (ctx.appState === 'scanned') {
    if (qty !== null) return { action: 'add', qty };
    if (t.includes('ja') || t.includes('yes') || t.includes('toevoegen') || t.includes('add')) return { action: 'accept' };
    if (t.includes('nee') || t.includes('no') || t.includes('skip') || t.includes('overslaan')) return { action: 'skip' };
  }

  if (ctx.appState === 'quantity') {
    if (qty !== null) return { action: 'add', qty };
    if (t.includes('klaar') || t.includes('done') || t.includes('bevestig')) return { action: 'confirm_qty' };
    if (t.includes('annuleer') || t.includes('cancel')) return { action: 'cancel' };
  }

  if (ctx.appState === 'idle') {
    if (removalTarget) return { action: 'remove', productQuery: removalTarget };
    if (t.includes('scan') || t.includes('product')) return { action: 'scan' };
    if (t.includes('mandje') || t.includes('basket') || t.includes('totaal')) return { action: 'read_basket' };
    if (t.includes('betaal') || t.includes('checkout') || t.includes('afrekenen')) return { action: 'checkout' };
    if (t.includes('saldo') || t.includes('balance')) return { action: 'read_balance' };
  }

  if (ctx.appState === 'added') {
    if (removalTarget) return { action: 'remove', productQuery: removalTarget };
  }

  if (ctx.appState === 'checkout') {
    if (removalTarget) return { action: 'remove', productQuery: removalTarget };
    if (t.includes('betaal') || t.includes('ja') || t.includes('yes') || t.includes('bevestig')) return { action: 'pay' };
    if (t.includes('annuleer') || t.includes('nee') || t.includes('terug')) return { action: 'cancel' };
  }

  const result = { action: 'unknown' };
  console.log(`[SituationGraph] processVoiceInput result:`, result);
  return result;
}
