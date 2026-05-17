// Database Application Spinner — entrypoint loaded by the Weaver.
//
// The Spinner exports its type contract from this module; the actual
// runtime work (research via `context.fetch`, screen drafting via
// `context.quietLoom`, session persistence via `context.session`)
// lives in the Loom's `weaver.ts` bootstrap dispatcher
// (`dispatchDatabaseApplication`) for the bootstrap epoch. When the
// canonical Python+FastAPI Weaver lands, the contract here does not
// change; only the dispatcher does.
//
// The contract is screen-first per `SCREEN-FIRST-AUTHORING.md`:
// the Spinner proposes screens (forms, lists, details, reports) plus
// three branding palettes; the patron prunes through clarifications;
// build derives the schema from the screens and creates the
// collections.

import type { SpinnerName, SpinnerContext } from '@webspinner-foundation/sdk';

export type Capability = 'propose' | 'refine' | 'build';

// ── Screen shapes ─────────────────────────────────────────────────

export type ScreenKind = 'form' | 'list' | 'detail' | 'report';

export type FormFieldKind =
  | 'text'
  | 'long-text'
  | 'number'
  | 'date'
  | 'money'
  | 'yes-no'
  | 'choice'
  | 'multi-choice'
  | 'link-to';

export interface FormField {
  readonly id: string;
  readonly label: string;
  readonly describes?: string;
  readonly kind: FormFieldKind;
  readonly required?: boolean;
  readonly options?: readonly string[];
  readonly linkTo?: string;
}

export interface FormSection {
  readonly title?: string;
  readonly describes?: string;
  readonly fields: readonly FormField[];
}

export interface FormLayout {
  readonly sections: readonly FormSection[];
}

export interface ListColumn {
  readonly fieldId: string;
  readonly label?: string;
  readonly width?: 'narrow' | 'normal' | 'wide';
}

export interface ListLayout {
  readonly columns: readonly ListColumn[];
  readonly defaultSort?: { readonly field: string; readonly direction: 'asc' | 'desc' };
  readonly filterFields?: readonly string[];
}

export interface DetailLayout {
  readonly showFields: readonly string[];
  readonly relatedScreens?: readonly string[];
}

export interface ReportLayout {
  readonly describes: string;
  readonly sourceEntities: readonly string[];
  readonly groupBy?: string;
  readonly aggregations?: readonly string[];
}

export type ScreenLayout = FormLayout | ListLayout | DetailLayout | ReportLayout;

export interface Screen {
  readonly id: string;
  readonly kind: ScreenKind;
  readonly name: string;
  readonly describes: string;
  /** kebab-case entity name; the entity this screen reads/writes. Reports
   * that span multiple entities have a primary parent + sourceEntities. */
  readonly parentEntity: string;
  readonly layout: ScreenLayout;
}

export interface NavItem {
  readonly label: string;
  readonly primary: boolean;
  readonly screens: readonly string[];
}

// ── Branding shapes ───────────────────────────────────────────────

export interface BrandingPalette {
  readonly bg: string;
  readonly surface: string;
  readonly surfaceAlt: string;
  readonly text: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly gold: string;
  readonly border: string;
}

export interface BrandingOption {
  readonly id: string;
  readonly name: string;
  readonly mood: string;
  readonly palette: BrandingPalette;
}

export interface BrandingState {
  readonly options: readonly BrandingOption[];
  readonly selectedPaletteId: string | null;
  readonly customDescription?: string;
  readonly referenceUrl?: string;
}

// ── Screens-draft envelope ────────────────────────────────────────

export interface ScreensDraft {
  readonly appName: string;
  readonly domain: string;
  readonly screens: readonly Screen[];
  readonly navigation: readonly NavItem[];
}

// ── Capability inputs / outputs ───────────────────────────────────

export interface ProposeInput {
  readonly patronSentence: string;
}

export type ClarificationKind = 'single-choice' | 'multi-choice' | 'free-text' | 'yes-no';

export interface Clarification {
  readonly id: string;
  readonly question: string;
  readonly kind: ClarificationKind;
  readonly options?: readonly string[];
  /** Optional pointer at the screen / field the answer modifies. */
  readonly affects?: {
    readonly screenId?: string;
    readonly fieldId?: string;
    readonly aspect?: 'branding' | 'screen' | 'field';
  };
}

export interface ProposeOutput {
  readonly narration: string;
  readonly domain?: string;
  readonly screensDraft?: ScreensDraft;
  readonly branding?: BrandingState;
  readonly clarifications: readonly Clarification[];
  readonly phase: 'proposed';
}

export type ClarificationAnswer = string | readonly string[] | boolean;

export interface RefineAnswer {
  readonly id: string;
  readonly answer: ClarificationAnswer;
}

export interface RefineInput {
  readonly answers: readonly RefineAnswer[];
}

export interface RefineOutput {
  readonly narration: string;
  readonly screensDraft?: ScreensDraft;
  readonly branding?: BrandingState;
  readonly clarifications: readonly Clarification[];
  readonly readyToBuild: boolean;
  readonly phase: 'refining' | 'ready';
}

export type BuildInput = Readonly<Record<string, never>>;

export type ArtifactKind = 'collection' | 'view' | 'report' | 'binding' | 'screen';

export interface BuildArtifact {
  readonly kind: ArtifactKind;
  readonly name: string;
  readonly location: string;
}

export interface BuildOutput {
  readonly narration: string;
  readonly appId: string;
  readonly deployedSurfaceUrl: string;
  readonly entities: readonly {
    readonly name: string;
    readonly slug: string;
    readonly collectionName: string;
  }[];
  readonly screens: readonly Screen[];
  readonly navigation: readonly NavItem[];
  readonly branding: BrandingState;
  readonly artifacts: readonly BuildArtifact[];
  readonly phase: 'built';
}

// ── Spinner-internal session state ────────────────────────────────

export interface DatabaseApplicationSession {
  readonly version: 2;
  readonly patronSentence: string;
  readonly domain?: string;
  readonly screensDraft?: ScreensDraft;
  readonly branding?: BrandingState;
  readonly sources: readonly string[];
  readonly turns: readonly {
    readonly capability: Capability;
    readonly clarifications: readonly Clarification[];
    readonly answers?: readonly RefineAnswer[];
    readonly timestamp: string;
  }[];
  readonly built?: {
    readonly appId: string;
    readonly deployedSurfaceUrl: string;
    readonly timestamp: string;
  };
}

export const SPINNER_ID = '@webspinner-foundation/database-application' as SpinnerName;

/**
 * The Weaver calls this. The bootstrap dispatcher in
 * `loom/src/lib/server/weaver.ts` (`dispatchDatabaseApplication`)
 * supersedes this throw — it constructs the `SpinnerContext` and runs
 * the actual research / screens-drafting / build work. When the
 * canonical Python Weaver lands, this module's contract remains the
 * truth.
 */
export async function invoke(
  capability: Capability,
  input: unknown,
  context: SpinnerContext,
): Promise<unknown> {
  void input;
  void context;
  throw new Error(
    `Database Application invocation pending Weaver runtime. Capability="${capability}". ` +
      `Bootstrap dispatch lives in the Loom's weaver.ts; this module's contract does ` +
      `not change when the Python Weaver lands.`,
  );
}
