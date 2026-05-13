/**
 * Weaver's Tension — iframe driver.
 *
 * Same-origin DOM-manipulation primitives the player uses to drive
 * the iframe on behalf of the patron. The patron watches; this code
 * does the typing and clicking.
 *
 * Requires the iframe to be same-origin and have `allow-same-origin`
 * in its sandbox attribute (we set that in the player's <iframe>).
 * Cross-origin would fail at contentDocument access.
 */

export class DriverError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DriverError';
  }
}

export interface DriverSignals {
  /** Resolves when the driver should pause; never rejects. */
  readonly paused: () => Promise<void>;
  /** Throws DriverError('stopped') if the run was stopped. */
  readonly stopGuard: () => void;
}

const NOOP_SIGNALS: DriverSignals = {
  paused: async () => undefined,
  stopGuard: () => undefined,
};

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class IframeDriver {
  constructor(
    private readonly iframe: HTMLIFrameElement,
    private readonly signals: DriverSignals = NOOP_SIGNALS,
  ) {}

  private get doc(): Document {
    const d = this.iframe.contentDocument;
    if (!d) throw new DriverError('iframe-contentDocument-null');
    return d;
  }

  private get win(): Window {
    const w = this.iframe.contentWindow;
    if (!w) throw new DriverError('iframe-contentWindow-null');
    return w;
  }

  /** Navigate the iframe to a path under the Loom's origin. */
  async navigate(
    path: string,
    opts: { waitForRoute?: string; timeoutMs?: number } = {},
  ): Promise<void> {
    this.signals.stopGuard();
    const timeoutMs = opts.timeoutMs ?? 8000;
    const target = path;
    await this.loadAndWait(() => {
      // contentWindow.location.href triggers a real navigation that
      // emits a load event on the iframe, so awaiting `load` works.
      this.win.location.href = target;
    }, timeoutMs);
    if (opts.waitForRoute) {
      await this.waitForRoute(opts.waitForRoute, timeoutMs);
    }
  }

  /** Resolve when the iframe's pathname matches `route`. */
  async waitForRoute(route: string, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.signals.stopGuard();
      await this.signals.paused();
      let current: string | null;
      try {
        current = this.iframe.contentWindow?.location.pathname ?? null;
      } catch {
        current = null;
      }
      if (current === route) return;
      await sleep(100);
    }
    let observed = '<unknown>';
    try {
      observed = this.iframe.contentWindow?.location.pathname ?? '<unknown>';
    } catch {
      // ignore
    }
    throw new DriverError('timeout-wait-for-route', { expected: route, observed, timeoutMs });
  }

  /** Resolve to the first element matching `selector` once it appears. */
  async waitForSelector(selector: string, timeoutMs = 8000): Promise<Element> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.signals.stopGuard();
      await this.signals.paused();
      try {
        const el = this.doc.querySelector(selector);
        if (el) return el;
      } catch {
        // doc may not be ready yet
      }
      await sleep(100);
    }
    throw new DriverError('timeout-wait-for-selector', { selector, timeoutMs });
  }

  /** Type into an input or textarea; dispatches input + change so Svelte's bind:value picks it up. */
  async fill(selector: string, value: string): Promise<void> {
    this.signals.stopGuard();
    const el = await this.waitForSelector(selector);
    const tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
      throw new DriverError('fill-target-not-input', { selector, tag });
    }
    // Cross-frame: an iframe's HTMLInputElement constructor differs from
    // ours, so we duck-type via tagName + property access. Use the
    // iframe's own prototype value-setter so frameworks observing
    // property descriptors (Svelte / React / Vue) see the change.
    const input = el as unknown as HTMLInputElement | HTMLTextAreaElement;
    input.focus();
    const proto =
      tag === 'TEXTAREA'
        ? (this.win as unknown as { HTMLTextAreaElement: { prototype: HTMLTextAreaElement } })
            .HTMLTextAreaElement.prototype
        : (this.win as unknown as { HTMLInputElement: { prototype: HTMLInputElement } })
            .HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    const EventCtor = (this.win as unknown as { Event: typeof Event }).Event;
    input.dispatchEvent(new EventCtor('input', { bubbles: true }));
    input.dispatchEvent(new EventCtor('change', { bubbles: true }));
    input.blur();
  }

  /** Click an element. Optionally wait for a route transition afterwards. */
  async click(
    selector: string,
    opts: { waitForRoute?: string; timeoutMs?: number } = {},
  ): Promise<void> {
    this.signals.stopGuard();
    const el = await this.waitForSelector(selector);
    if (opts.waitForRoute) {
      const timeoutMs = opts.timeoutMs ?? 8000;
      // Click first, then await route — the click may trigger a SvelteKit
      // client-side nav OR a full reload; either way waitForRoute polls.
      (el as HTMLElement).click();
      await this.waitForRoute(opts.waitForRoute, timeoutMs);
    } else {
      (el as HTMLElement).click();
    }
  }

  /** Submit a form. Finds the form's submit button and clicks it (so SvelteKit's use:enhance interceptor runs). */
  async submit(
    formSelector: string,
    opts: { waitForRoute?: string; timeoutMs?: number } = {},
  ): Promise<void> {
    this.signals.stopGuard();
    const form = await this.waitForSelector(formSelector);
    if (form.tagName !== 'FORM') {
      throw new DriverError('submit-target-not-form', { formSelector, tag: form.tagName });
    }
    const submitBtn = form.querySelector(
      'button[type="submit"], input[type="submit"]',
    ) as HTMLElement | null;
    if (submitBtn) submitBtn.click();
    else (form as unknown as HTMLFormElement).requestSubmit();
    if (opts.waitForRoute) {
      const timeoutMs = opts.timeoutMs ?? 8000;
      await this.waitForRoute(opts.waitForRoute, timeoutMs);
    }
  }

  /** Read an attribute / property / textContent for the iframe-element verifier. */
  async readElement(
    selector: string,
    read: string,
    timeoutMs = 4000,
  ): Promise<{ ok: true; value: string } | { ok: false; reason: string }> {
    try {
      const el = await this.waitForSelector(selector, timeoutMs);
      const tag = el.tagName;
      let value: string | null = null;
      if (read === 'textContent') {
        value = el.textContent;
      } else if (read === 'value') {
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          value = (el as unknown as { value: string }).value;
        } else {
          value = el.getAttribute('value');
        }
      } else if (read === 'checked') {
        if (tag === 'INPUT') value = String((el as unknown as { checked: boolean }).checked);
        else value = el.getAttribute('checked') !== null ? 'true' : 'false';
      } else {
        value = el.getAttribute(read);
      }
      return { ok: true, value: value ?? '' };
    } catch (e) {
      const detail = e instanceof DriverError ? e.message : String(e);
      return { ok: false, reason: detail };
    }
  }

  // ── helpers ───────────────────────────────────────────────────

  /** Run a `trigger` that causes an iframe load, then await the load event (or timeout). */
  private loadAndWait(trigger: () => void, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const onLoad = () => {
        if (settled) return;
        settled = true;
        this.iframe.removeEventListener('load', onLoad);
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.iframe.removeEventListener('load', onLoad);
        reject(new DriverError('timeout-iframe-load', { timeoutMs }));
      }, timeoutMs);
      this.iframe.addEventListener('load', onLoad);
      try {
        trigger();
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        this.iframe.removeEventListener('load', onLoad);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
}
