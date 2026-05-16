# How the Database Application Spinner works

The Webspinner Foundation's Database Application Spinner takes one plain-English sentence about what you want to keep track of, does the homework on your behalf, and gives you a working web application that does it.

Bookkeeping for your business. A log of every plant in your garden. Donors and gifts for your church. Service history for your customers. Whatever you want to track. Same Spinner, different domain. You speak the sentence; it builds the thing.

You do not write code. You do not pick column types. You do not design forms. The Spinner does all of that for you, in your domain's words, and explains every decision it makes.

## What it does, in one conversation

The Spinner works in three turns. You drive the pace.

### Turn one — _I listen, I look, I sketch_

You speak your sentence: **"I want a bookkeeping system."**

The Spinner reads the canonical public reference on the domain (Wikipedia's article on bookkeeping, in this case) and pulls out the standard shape — what bookkeeping is about, what entities it tracks, what the canonical reports look like. It cites the source so you can read it yourself.

Then it sketches a starting point — in _your_ domain's words, not engineering's. _"Here's what I'd start with: a Transactions list where each entry records what happened, when, how much, and which account it touched. An Accounts list with the standard five categories. An Invoices list (only if you bill customers). A Customers list (only if invoices are in)."_

And it asks three or four focused questions about _your_ situation. Not engineering questions — your questions: _"Do you take cash, card, or both?" "Do you invoice, or sell at the point of sale, or both?"_

### Turn two — _we refine it together_

You answer. The Spinner updates the sketch. _"Got it — I've added an Invoice entity with line items, and connected each line item back to a transaction so the books reconcile."_

If anything's still ambiguous, the Spinner asks the next set of focused questions. This goes on for as many turns as it takes — usually two or three. The Spinner stops asking when there's nothing material left to clarify; you can stop refining any time and say _"build it."_

### Turn three — _here's the working thing_

The Spinner builds the application — the collections in the Foundation's data layer, the list views, the detail forms, the canonical reports for your domain — and gives you the URL where it lives. _"Your bookkeeping is ready. Record a transaction at /db/your-app/transactions. See this month's books at /db/your-app/reports. The reconciliation report runs every time you add a transaction. Try it, and tell me what's missing."_

## What you can ask it to track

Any domain where the work is _"keeping track of things."_ Some examples:

- **A small business's books.** Transactions, accounts, customers, invoices, the canonical financial reports.
- **A garden.** Plants by species, planting date, location, watering schedule, harvest record.
- **A church or nonprofit's donor log.** Donors, gifts, campaigns, recognition, year-end statements.
- **A service business's customers.** Customers, jobs, visit history, parts used, warranty record.
- **A teacher's gradebook.** Students, assignments, scores, attendance, progress reports.
- **An estate's inventory.** Items, locations, values, photos, provenance.
- **A clinic's patient list.** Patients, visits, diagnoses, treatment plans, follow-ups. _(See the limits below.)_

If you can describe what you want to keep track of in one sentence, the Spinner can probably build it.

## What it will not do

There are kinds of records the Foundation will not build into a database application — not because they're technically hard, but because the Foundation Pledge refuses them. The Spinner will tell you plainly when your request crosses one of these lines, and stop.

- **Anything that tracks another person without their consent.** A monitoring app for an employee, an ex-partner, or a person who has not agreed — the Spinner refuses. There is no version of this request the Spinner can help with.
- **Payment card numbers, bank account numbers, Social Security numbers, account passwords, or API tokens.** These need different storage than this Spinner provides. A payment processor (Stripe, Square, etc.) handles the cards; a password manager handles the passwords. The Spinner builds everything _else_ in your application — and refers you to the right tool for the credential-class data.
- **Behavioural targeting, ad tracking, dark patterns.** Refused.

The Spinner will say _"I can't help build this one, and here's why"_ — once — and offer to help with whatever else you actually need.

## The Synthetic Intelligence the Spinner uses

Every reasoning step happens on this Cell's own hardware. The Foundation does not send your description, your domain, your schema, or any of your data to a hyperscaler. The local Synthetic Intelligence — running on Apple Silicon in this Cell — reads the public reference material, drafts the schema, generates the questions, and writes the narration. Sovereignty by architecture.

Public-domain reference material (today, Wikipedia) is the only external thing the Spinner reaches for. Every web fetch is recorded in the Cell's audit log; you can see exactly what the Spinner read on your behalf, when, and from where.

## What lives in the Cell after you build

Three things, all in this Cell, all yours:

1. **The collections themselves** — the rows you'll add to as you use the application. Your transactions. Your plants. Your donors.
2. **The schema** — what each collection's entries track, what they're linked to, what reports run against them. Inspectable, exportable, modifiable.
3. **The conversation that produced them** — the prior turns, the cited sources, the decisions the Spinner made and why. Recoverable if you come back later and want to add something to your application.

## Re-entrancy — leave any time, come back any time

You can close the tab, walk away, come back tomorrow on a different device. The Spinner remembers where you left off. The next turn picks up exactly there, with the prior research, the prior schema draft, the prior answers all loaded. No "start over."

## When the Spinner can't research your domain

The Spinner reads from a small, deliberately curated set of credible public references. If your domain is specialised enough that those references don't cover it well, the Spinner says so plainly — _"the public references I can reach are light on this one; tell me more about how [your specific thing] works"_ — and the conversation moves forward on your knowledge instead of the Spinner's.

As the Foundation curates more reference sources (specific industries, regulatory domains, niche fields), the Spinner reaches more domains directly. Each addition is a Foundation curation decision recorded in the open.

## When the application is yours, in the Foundation's sense

When the Spinner finishes building, the application is in your Cell. The collections are in your Grimoire. The conversation is in your Silk Pattern. The schema is yours to modify (the Spinner can come back and refine it any time). The data you add is yours. The Foundation does not retain any of it; the Foundation does not see any of it. Sovereignty is structural, not promised — the architecture is what makes this true.

## Limits, named plainly

- **Single-user applications, for now.** This Spinner builds applications for one Webspinner. Multi-user permissions (Bob can see Alice's invoices but not Carol's) is a future enhancement.
- **One Spinner, one application per session.** If you want a bookkeeping system _and_ a garden log, that's two separate conversations producing two separate applications.
- **Reports today are the canonical ones for your domain.** Custom reports — _"show me last quarter's revenue by customer category, sorted by month"_ — are coming in a future revision.
- **No editor for the schema, yet.** If you want to add a field the Spinner didn't add, ask the Spinner to refine; don't try to edit the schema directly.

These limits exist because shipping the first version finished is more important than shipping the second version aspirational. Each will lift as the Foundation builds toward the next archetype.

---

_The Database Application Spinner is one of the first Webspinner-facing Spinners the Foundation ships. The shape it sets — listen, research, propose, clarify, refine, build, explain — is the shape every future Webspinner-facing Spinner inherits. Bookkeeping is the first archetype; the architecture is the contract._
