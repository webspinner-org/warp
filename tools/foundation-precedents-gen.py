#!/usr/bin/env python3
"""Generate the Foundation precedent library from compact specs.

Each precedent is a ScreensDraft (per loom/src/lib/server/
database-applications.ts:104) plus a branding palette. The spec
below is compact (~30 lines per precedent); this generator fills in
the FormLayout/ListLayout/DetailLayout boilerplate consistently so
all precedents read the same shape.

Output:
  ~/warp/foundation-precedents/<slug>/schema.json
  ~/warp/foundation-precedents/<slug>/narrative.md

Idempotent. Re-run any time after editing the spec.
"""
from __future__ import annotations
import json
import os
import pathlib
import sys
from dataclasses import dataclass, field
from typing import Optional

REPO = pathlib.Path(__file__).resolve().parents[1]
OUT_DIR = REPO / 'foundation-precedents'


# ── Palettes ──────────────────────────────────────────────────────────

PALETTES = {
    'warm-bookkeeping': {
        'bg': '#1a1410', 'surface': '#241b15', 'surfaceAlt': '#2f231a',
        'border': '#3d2f24', 'text': '#f0e6d4', 'textMuted': '#bba990',
        'accent': '#d4a85a', 'accentSoft': '#e6c486',
        'gold': '#d4a85a', 'name': 'Warm Books',
    },
    'cool-spring': {
        'bg': '#0f1814', 'surface': '#162822', 'surfaceAlt': '#1f3a31',
        'border': '#2a4a3f', 'text': '#dcefe2', 'textMuted': '#90b3a3',
        'accent': '#7ac79c', 'accentSoft': '#a3dcb9',
        'gold': '#d4a85a', 'name': 'Spring Garden',
    },
    'foundation-cyan': {
        'bg': '#1a262e', 'surface': '#233440', 'surfaceAlt': '#2c4250',
        'border': '#34465290', 'text': '#ece4d4', 'textMuted': '#a4b4c0',
        'accent': '#5fd2ed', 'accentSoft': '#88dff0',
        'gold': '#d4a85a', 'name': 'Foundation',
    },
    'paper': {
        'bg': '#f8f5ed', 'surface': '#ffffff', 'surfaceAlt': '#f0e9d8',
        'border': '#d4c8b0', 'text': '#1f1a14', 'textMuted': '#6a5d4a',
        'accent': '#8a6a3a', 'accentSoft': '#b8965f',
        'gold': '#b8965f', 'name': 'Paper',
    },
    'stone': {
        'bg': '#1d1d1a', 'surface': '#2a2a26', 'surfaceAlt': '#363632',
        'border': '#4a4a45', 'text': '#e8e5dd', 'textMuted': '#a8a59c',
        'accent': '#a89060', 'accentSoft': '#c4b080',
        'gold': '#c4b080', 'name': 'Stone',
    },
}


# ── Field-kind shortcuts ─────────────────────────────────────────────

def f(fid: str, kind: str, *, label: str | None = None,
      required: bool = False, options: list[str] | None = None,
      linkTo: str | None = None, describes: str | None = None) -> dict:
    out = {'id': fid, 'label': label or fid.replace('_', ' ').replace('-', ' ').title(),
           'kind': kind}
    if required:
        out['required'] = True
    if options is not None:
        out['options'] = list(options)
    if linkTo is not None:
        out['linkTo'] = linkTo
    if describes is not None:
        out['describes'] = describes
    return out


# ── Entity spec ──────────────────────────────────────────────────────

@dataclass
class Entity:
    name: str               # singular
    label: str              # for the form heading; default capitalize(name)
    describes: str          # one-line describes for screens
    fields: list[dict]
    list_columns: list[str] | None = None   # default first 3-4 field ids
    default_sort: dict | None = None        # {'field': 'created_at', 'direction': 'desc'}
    plural: str | None = None               # for nav labels

    @property
    def display_plural(self) -> str:
        return self.plural or (self.name + 's')


@dataclass
class Report:
    name: str
    describes: str
    source_entities: list[str]
    group_by: str | None = None
    aggregations: list[str] = field(default_factory=list)


@dataclass
class Precedent:
    slug: str
    app_name: str
    domain: str
    sentence: str
    branding_id: str
    entities: list[Entity]
    reports: list[Report] = field(default_factory=list)
    narrative: str = ''


# ── Generation ───────────────────────────────────────────────────────

def build_form(entity: Entity) -> dict:
    return {
        'id': f'form-{entity.name}',
        'kind': 'form',
        'name': f'Add {entity.label}' if entity.label else f'Add {entity.name.title()}',
        'describes': entity.describes,
        'parentEntity': entity.name,
        'layout': {
            'sections': [{
                'title': entity.label or entity.name.title(),
                'fields': list(entity.fields),
            }],
        },
    }


def build_list(entity: Entity) -> dict:
    cols = entity.list_columns or [fld['id'] for fld in entity.fields[:4]]
    layout = {
        'columns': [{'fieldId': c} for c in cols],
    }
    if entity.default_sort:
        layout['defaultSort'] = dict(entity.default_sort)
    return {
        'id': f'list-{entity.name}',
        'kind': 'list',
        'name': f'All {entity.display_plural}',
        'describes': f'Browse all {entity.display_plural}.',
        'parentEntity': entity.name,
        'layout': layout,
    }


def build_detail(entity: Entity) -> dict:
    return {
        'id': f'detail-{entity.name}',
        'kind': 'detail',
        'name': f'{entity.label or entity.name.title()} details',
        'describes': f'View one {entity.name}.',
        'parentEntity': entity.name,
        'layout': {
            'showFields': [fld['id'] for fld in entity.fields],
        },
    }


def build_report_screen(entity_anchor: str, r: Report) -> dict:
    layout = {
        'describes': r.describes,
        'sourceEntities': list(r.source_entities),
    }
    if r.group_by:
        layout['groupBy'] = r.group_by
    if r.aggregations:
        layout['aggregations'] = list(r.aggregations)
    return {
        'id': f'report-{r.name.lower().replace(" ", "-")}',
        'kind': 'report',
        'name': r.name,
        'describes': r.describes,
        'parentEntity': entity_anchor,
        'layout': layout,
    }


def build_navigation(entities: list[Entity], reports: list[Report]) -> list[dict]:
    nav = []
    for e in entities:
        nav.append({
            'label': e.display_plural.title(),
            'primary': nav == [],
            'screens': [f'form-{e.name}', f'list-{e.name}'],
        })
    if reports:
        nav.append({
            'label': 'Reports',
            'primary': False,
            'screens': [f'report-{r.name.lower().replace(" ", "-")}' for r in reports],
        })
    return nav


def build_screens_draft(p: Precedent) -> dict:
    screens = []
    for e in p.entities:
        screens.append(build_form(e))
        screens.append(build_list(e))
        screens.append(build_detail(e))
    if p.reports:
        anchor = p.entities[0].name
        for r in p.reports:
            screens.append(build_report_screen(anchor, r))
    palette = PALETTES[p.branding_id]
    branding = {
        'options': [{
            'id': p.branding_id,
            'name': palette['name'],
            'mood': 'warm' if 'warm' in p.branding_id or p.branding_id == 'paper' else 'cool',
            'palette': {k: v for k, v in palette.items() if k != 'name'},
        }],
        'selectedPaletteId': p.branding_id,
    }
    return {
        'appName': p.app_name,
        'domain': p.domain,
        'screens': screens,
        'navigation': build_navigation(p.entities, p.reports),
        'branding': branding,
    }


def write_precedent(p: Precedent) -> None:
    d = OUT_DIR / p.slug
    d.mkdir(parents=True, exist_ok=True)
    schema = build_screens_draft(p)
    (d / 'schema.json').write_text(json.dumps(schema, indent=2) + '\n')
    narrative_md = (
        f'# {p.app_name}\n\n'
        f'**Domain:** {p.domain}\n\n'
        f'**Patron-style sentence:**\n\n'
        f'> {p.sentence}\n\n'
        f'**Why these entities, not others:**\n\n'
        f'{p.narrative.strip()}\n'
    )
    (d / 'narrative.md').write_text(narrative_md)


# ── The 15 seed precedents ───────────────────────────────────────────

PRECEDENTS: list[Precedent] = [
    # 1. BOOKKEEPING — small-business books
    Precedent(
        slug='bookkeeping',
        app_name='Business Ledger',
        domain='small-business bookkeeping',
        sentence='I keep the books for a small business — transactions, accounts, customers, invoices, simple reports.',
        branding_id='warm-bookkeeping',
        entities=[
            Entity('transaction', 'Transaction', 'Record a transaction.',
                   fields=[
                       f('date', 'date', required=True),
                       f('amount', 'money', required=True),
                       f('direction', 'choice', options=['income', 'expense']),
                       f('account', 'link-to', linkTo='account', required=True),
                       f('customer', 'link-to', linkTo='customer'),
                       f('category', 'choice', options=['sales', 'cogs', 'rent', 'utilities', 'wages', 'marketing', 'other']),
                       f('notes', 'long-text'),
                       f('reconciled', 'yes-no'),
                   ],
                   list_columns=['date', 'amount', 'direction', 'category', 'customer'],
                   default_sort={'field': 'date', 'direction': 'desc'}),
            Entity('account', 'Account', 'Name an account.',
                   fields=[
                       f('name', 'text', required=True),
                       f('kind', 'choice', options=['checking', 'savings', 'credit', 'cash']),
                       f('opening_balance', 'money'),
                       f('notes', 'long-text'),
                   ]),
            Entity('customer', 'Customer', 'Add a customer.',
                   fields=[
                       f('name', 'text', required=True),
                       f('email', 'text'),
                       f('phone', 'text'),
                       f('notes', 'long-text'),
                   ]),
        ],
        reports=[
            Report('Profit and Loss', 'Income minus expenses by period.',
                   source_entities=['transaction'], group_by='category', aggregations=['sum:amount']),
            Report('Cash Flow', 'Net cash movement by account by month.',
                   source_entities=['transaction'], group_by='account', aggregations=['sum:amount']),
        ],
        narrative='Bookkeeping is fundamentally double-entry: every value flows between accounts. Transaction is the central entity; account is what it moves between; customer attributes the income/expense. Category enables P&L. Reconciliation flag enables the "did this match the bank statement" check that defines real bookkeeping (not just spreadsheet tracking).',
    ),

    # 2. GARDEN LOG
    Precedent(
        slug='garden-log',
        app_name='Garden Log',
        domain='garden tracking',
        sentence='I want to track plants in my garden — what I planted, when, how I water and feed them, what I harvest.',
        branding_id='cool-spring',
        entities=[
            Entity('plant', 'Plant', 'Record a plant.',
                   fields=[
                       f('name', 'text', required=True),
                       f('variety', 'text'),
                       f('planted_at', 'date', required=True),
                       f('location', 'choice', options=['front-bed', 'back-bed', 'side-bed', 'container', 'raised-bed', 'greenhouse']),
                       f('sun', 'choice', options=['full-sun', 'part-sun', 'shade']),
                       f('notes', 'long-text'),
                       f('removed', 'yes-no'),
                   ],
                   list_columns=['name', 'variety', 'planted_at', 'location']),
            Entity('watering', 'Watering', 'Log a watering.',
                   fields=[
                       f('plant', 'link-to', linkTo='plant', required=True),
                       f('watered_at', 'date', required=True),
                       f('method', 'choice', options=['hand', 'drip', 'sprinkler', 'rainwater']),
                       f('notes', 'text'),
                   ]),
            Entity('feeding', 'Feeding', 'Log a feeding or amendment.',
                   fields=[
                       f('plant', 'link-to', linkTo='plant', required=True),
                       f('fed_at', 'date', required=True),
                       f('product', 'text'),
                       f('amount', 'text'),
                       f('notes', 'text'),
                   ]),
            Entity('harvest', 'Harvest', 'Log a harvest.',
                   fields=[
                       f('plant', 'link-to', linkTo='plant', required=True),
                       f('harvested_at', 'date', required=True),
                       f('quantity', 'text'),
                       f('notes', 'text'),
                   ]),
        ],
        reports=[
            Report('Harvest by Plant', 'Total harvest per plant.',
                   source_entities=['harvest'], group_by='plant'),
        ],
        narrative='Gardening is event-driven: plants are stable entities; waterings, feedings, harvests are events keyed to a plant. Separate event entities (vs one giant "log") let the patron sort and aggregate per kind. Location + sun on the plant capture the standing conditions that matter for diagnosing trouble.',
    ),

    # 3. DONOR CRM
    Precedent(
        slug='donor-crm',
        app_name='Donor Records',
        domain='nonprofit donor tracking',
        sentence='I manage donors for a small nonprofit — gifts, contacts, campaigns, thank-you letters sent.',
        branding_id='foundation-cyan',
        entities=[
            Entity('donor', 'Donor', 'Add a donor.',
                   fields=[
                       f('name', 'text', required=True),
                       f('email', 'text'),
                       f('phone', 'text'),
                       f('address', 'long-text'),
                       f('first_gift_at', 'date'),
                       f('notes', 'long-text'),
                       f('do_not_contact', 'yes-no'),
                   ],
                   list_columns=['name', 'email', 'first_gift_at']),
            Entity('gift', 'Gift', 'Record a gift.',
                   fields=[
                       f('donor', 'link-to', linkTo='donor', required=True),
                       f('amount', 'money', required=True),
                       f('received_at', 'date', required=True),
                       f('campaign', 'link-to', linkTo='campaign'),
                       f('method', 'choice', options=['check', 'card', 'cash', 'wire', 'stock', 'in-kind']),
                       f('restricted', 'yes-no'),
                       f('thank_you_sent', 'yes-no'),
                       f('notes', 'long-text'),
                   ],
                   list_columns=['received_at', 'donor', 'amount', 'campaign'],
                   default_sort={'field': 'received_at', 'direction': 'desc'}),
            Entity('campaign', 'Campaign', 'Name a campaign.',
                   fields=[
                       f('name', 'text', required=True),
                       f('starts_at', 'date'),
                       f('ends_at', 'date'),
                       f('goal_amount', 'money'),
                       f('notes', 'long-text'),
                   ]),
        ],
        reports=[
            Report('Gifts by Campaign', 'Sum of gifts per campaign.',
                   source_entities=['gift'], group_by='campaign', aggregations=['sum:amount']),
            Report('Gifts by Donor', 'Total giving per donor.',
                   source_entities=['gift'], group_by='donor', aggregations=['sum:amount']),
        ],
        narrative='Nonprofit gift tracking needs donor stewardship signals built in (thank-you-sent, do-not-contact) — without them, the system is a glorified spreadsheet. Campaigns provide aggregation context that matters for grant reporting. Restricted flag matters for audit; method matters for reconciliation against the bank.',
    ),

    # 4. SERVICE TICKETS
    Precedent(
        slug='service-tickets',
        app_name='Service Tickets',
        domain='service-and-repair operations',
        sentence='Track service tickets — customer, vehicle (or item), problem, parts used, technician, completed.',
        branding_id='stone',
        entities=[
            Entity('ticket', 'Ticket', 'Open a service ticket.',
                   fields=[
                       f('opened_at', 'date', required=True),
                       f('customer', 'link-to', linkTo='customer', required=True),
                       f('item', 'link-to', linkTo='item'),
                       f('reported_problem', 'long-text', required=True),
                       f('status', 'choice', options=['open', 'waiting-on-parts', 'in-progress', 'completed', 'invoiced', 'closed']),
                       f('technician', 'link-to', linkTo='technician'),
                       f('priority', 'choice', options=['low', 'normal', 'high', 'urgent']),
                       f('completed_at', 'date'),
                       f('notes', 'long-text'),
                   ],
                   list_columns=['opened_at', 'customer', 'status', 'priority', 'technician'],
                   default_sort={'field': 'opened_at', 'direction': 'desc'},
                   plural='tickets'),
            Entity('customer', 'Customer', 'Add a customer.',
                   fields=[
                       f('name', 'text', required=True),
                       f('email', 'text'),
                       f('phone', 'text'),
                       f('address', 'long-text'),
                       f('notes', 'long-text'),
                   ]),
            Entity('item', 'Item', "Customer's item (vehicle, appliance, etc.).",
                   fields=[
                       f('owner', 'link-to', linkTo='customer', required=True),
                       f('description', 'text', required=True),
                       f('identifier', 'text', describes='VIN, serial number, etc.'),
                       f('year', 'number'),
                       f('notes', 'long-text'),
                   ],
                   plural='items'),
            Entity('technician', 'Technician', 'Add a technician.',
                   fields=[
                       f('name', 'text', required=True),
                       f('email', 'text'),
                       f('specialty', 'text'),
                   ]),
            Entity('part_used', 'Part Used', 'Record a part used on a ticket.',
                   fields=[
                       f('ticket', 'link-to', linkTo='ticket', required=True),
                       f('part_name', 'text', required=True),
                       f('quantity', 'number', required=True),
                       f('unit_cost', 'money'),
                       f('notes', 'text'),
                   ]),
        ],
        reports=[
            Report('Tickets by Status', 'Count open by status.',
                   source_entities=['ticket'], group_by='status', aggregations=['count']),
            Report('Tickets by Technician', 'Ticket count by tech.',
                   source_entities=['ticket'], group_by='technician', aggregations=['count']),
        ],
        narrative='Service operations live on the ticket. Customer and item are stable; ticket is event-shaped; parts-used is a many-to-many between tickets and parts. Status enum covers the operational lifecycle including the often-missed "waiting on parts" stall state. Priority makes triage practical.',
    ),

    # 5. RECIPE COLLECTION
    Precedent(
        slug='recipe-collection',
        app_name='Recipe Box',
        domain='home cooking',
        sentence="I want to organize my recipes — ingredients, steps, where I found them, what I've actually cooked.",
        branding_id='warm-bookkeeping',
        entities=[
            Entity('recipe', 'Recipe', 'Add a recipe.',
                   fields=[
                       f('name', 'text', required=True),
                       f('source', 'text', describes='Book, website, family member.'),
                       f('servings', 'number'),
                       f('time_minutes', 'number'),
                       f('cuisine', 'choice', options=['italian', 'mexican', 'chinese', 'thai', 'indian', 'american', 'mediterranean', 'french', 'japanese', 'other']),
                       f('tags', 'multi-choice', options=['quick', 'weeknight', 'company', 'leftovers', 'vegetarian', 'gluten-free']),
                       f('instructions', 'long-text', required=True),
                       f('notes', 'long-text'),
                       f('favorite', 'yes-no'),
                   ],
                   list_columns=['name', 'cuisine', 'time_minutes', 'favorite']),
            Entity('ingredient', 'Ingredient', 'Add an ingredient line.',
                   fields=[
                       f('recipe', 'link-to', linkTo='recipe', required=True),
                       f('item', 'text', required=True),
                       f('quantity', 'text'),
                       f('notes', 'text'),
                   ]),
            Entity('cook', 'Cooking session', 'Log when you cooked it.',
                   fields=[
                       f('recipe', 'link-to', linkTo='recipe', required=True),
                       f('cooked_at', 'date', required=True),
                       f('result', 'choice', options=['great', 'good', 'okay', 'not-again']),
                       f('changes', 'long-text', describes='What did you change vs the recipe?'),
                   ],
                   plural='cooks'),
        ],
        narrative='Recipes have ingredients as a sub-entity (one-to-many) so the patron can scale them, swap items, or pull a shopping list across recipes later. The cook log captures the "did this actually work" feedback that improves the collection over time. Cuisine + tags enable filtering, which is the main UX of a recipe collection.',
    ),

    # 6. CLUB ROSTER
    Precedent(
        slug='club-roster',
        app_name='Club Roster',
        domain='small-club membership',
        sentence='Track our club members, their dues, who showed up to which meetings.',
        branding_id='paper',
        entities=[
            Entity('member', 'Member', 'Add a member.',
                   fields=[
                       f('name', 'text', required=True),
                       f('email', 'text'),
                       f('phone', 'text'),
                       f('joined_at', 'date'),
                       f('status', 'choice', options=['active', 'inactive', 'honorary', 'lapsed']),
                       f('notes', 'long-text'),
                   ],
                   list_columns=['name', 'email', 'status', 'joined_at']),
            Entity('meeting', 'Meeting', 'Schedule a meeting.',
                   fields=[
                       f('held_on', 'date', required=True),
                       f('topic', 'text'),
                       f('location', 'text'),
                       f('notes', 'long-text'),
                   ],
                   default_sort={'field': 'held_on', 'direction': 'desc'}),
            Entity('attendance', 'Attendance', 'Mark a member present.',
                   fields=[
                       f('meeting', 'link-to', linkTo='meeting', required=True),
                       f('member', 'link-to', linkTo='member', required=True),
                       f('role', 'choice', options=['attendee', 'speaker', 'host', 'guest']),
                       f('notes', 'text'),
                   ]),
            Entity('dues_payment', 'Dues payment', 'Record a dues payment.',
                   fields=[
                       f('member', 'link-to', linkTo='member', required=True),
                       f('paid_at', 'date', required=True),
                       f('amount', 'money', required=True),
                       f('period', 'text', describes="e.g. '2026', '2026 Q1'"),
                       f('notes', 'text'),
                   ]),
        ],
        narrative='Clubs need three intersecting records: who belongs (member), what we did (meeting), who showed up (attendance). Dues are a separate stream because they often run on a different schedule than meetings. Status enum captures the realistic states small clubs run on, including "lapsed" — most rosters need it but rarely have it.',
    ),

    # 7. GEAR INVENTORY
    Precedent(
        slug='gear-inventory',
        app_name='Gear Inventory',
        domain='outdoor / craft gear tracking',
        sentence='Track my gear — what I own, where it is, what condition, when it was last checked.',
        branding_id='stone',
        entities=[
            Entity('item', 'Item', 'Add an item.',
                   fields=[
                       f('name', 'text', required=True),
                       f('category', 'choice', options=['shelter', 'sleep', 'cook', 'water', 'navigation', 'first-aid', 'apparel', 'electronics', 'tools', 'other']),
                       f('brand', 'text'),
                       f('model', 'text'),
                       f('acquired_at', 'date'),
                       f('cost', 'money'),
                       f('location', 'choice', options=['gear-room', 'closet', 'truck', 'shed', 'storage-unit', 'on-loan']),
                       f('condition', 'choice', options=['new', 'excellent', 'good', 'fair', 'poor', 'retired']),
                       f('last_inspected_at', 'date'),
                       f('notes', 'long-text'),
                   ],
                   list_columns=['name', 'category', 'location', 'condition']),
            Entity('trip', 'Trip', 'Record a trip.',
                   fields=[
                       f('name', 'text', required=True),
                       f('started_at', 'date'),
                       f('ended_at', 'date'),
                       f('location', 'text'),
                       f('notes', 'long-text'),
                   ]),
            Entity('packing_list_item', 'Packing list item', 'Item taken on a trip.',
                   fields=[
                       f('trip', 'link-to', linkTo='trip', required=True),
                       f('item', 'link-to', linkTo='item', required=True),
                       f('outcome', 'choice', options=['used', 'unused', 'broke', 'lost']),
                       f('notes', 'text'),
                   ]),
        ],
        narrative='Inventory tools fail when they treat items as static. Gear lives in cycles: acquired → used on trips → inspected → maintained → retired. The trip + packing-list pattern gives the patron a record of what they actually used, which is the question "should I keep this?" rests on. Location enum prevents the inventory from being a fiction.',
    ),

    # 8. TIME TRACKER
    Precedent(
        slug='time-tracker',
        app_name='Time Log',
        domain='consulting / project time tracking',
        sentence='Log my time on projects so I can invoice clients accurately.',
        branding_id='paper',
        entities=[
            Entity('client', 'Client', 'Add a client.',
                   fields=[
                       f('name', 'text', required=True),
                       f('email', 'text'),
                       f('hourly_rate', 'money'),
                       f('notes', 'long-text'),
                   ]),
            Entity('project', 'Project', 'Add a project.',
                   fields=[
                       f('name', 'text', required=True),
                       f('client', 'link-to', linkTo='client', required=True),
                       f('budget_hours', 'number'),
                       f('status', 'choice', options=['active', 'paused', 'completed', 'archived']),
                       f('notes', 'long-text'),
                   ]),
            Entity('time_entry', 'Time entry', 'Log time.',
                   fields=[
                       f('project', 'link-to', linkTo='project', required=True),
                       f('worked_on', 'date', required=True),
                       f('hours', 'number', required=True),
                       f('description', 'long-text', required=True),
                       f('billable', 'yes-no'),
                       f('invoiced', 'yes-no'),
                   ],
                   list_columns=['worked_on', 'project', 'hours', 'billable'],
                   default_sort={'field': 'worked_on', 'direction': 'desc'},
                   plural='time entries'),
        ],
        reports=[
            Report('Hours by Project', 'Total hours per project.',
                   source_entities=['time_entry'], group_by='project', aggregations=['sum:hours']),
            Report('Hours by Client', 'Total hours per client.',
                   source_entities=['time_entry'], group_by='project', aggregations=['sum:hours']),
            Report('Unbilled Time', 'Billable hours not yet invoiced.',
                   source_entities=['time_entry'], group_by='project', aggregations=['sum:hours']),
        ],
        narrative='Time-tracking apps fail by overcomplicating the entry form. The smallest useful entry is (project, date, hours, description) — everything else (billable, invoiced, tags) is optional metadata that lets the patron run reports. Billable + invoiced together give the consultant the "what do I owe a client an invoice for" view that is the whole point.',
    ),

    # 9. READING JOURNAL
    Precedent(
        slug='reading-journal',
        app_name='Reading Journal',
        domain='personal reading log',
        sentence='Track what I read — books, when I started and finished, what I thought.',
        branding_id='warm-bookkeeping',
        entities=[
            Entity('book', 'Book', 'Add a book.',
                   fields=[
                       f('title', 'text', required=True),
                       f('author', 'text', required=True),
                       f('genre', 'choice', options=['fiction', 'literary-fiction', 'sci-fi', 'fantasy', 'mystery', 'biography', 'history', 'science', 'philosophy', 'self-help', 'business', 'poetry', 'other']),
                       f('started_at', 'date'),
                       f('finished_at', 'date'),
                       f('rating', 'choice', options=['1', '2', '3', '4', '5']),
                       f('format', 'choice', options=['hardcover', 'paperback', 'ebook', 'audiobook']),
                       f('review', 'long-text'),
                       f('favorite', 'yes-no'),
                   ],
                   list_columns=['title', 'author', 'finished_at', 'rating'],
                   default_sort={'field': 'finished_at', 'direction': 'desc'}),
            Entity('quote', 'Quote', 'Save a quote.',
                   fields=[
                       f('book', 'link-to', linkTo='book', required=True),
                       f('text', 'long-text', required=True),
                       f('page', 'number'),
                       f('notes', 'long-text'),
                   ]),
        ],
        narrative='Reading journals are personal, not formal. Started-at and finished-at as separate optional dates let the patron capture "currently reading" (started but not finished) and "abandoned" (started, never finished, no rating). Quote as a sub-entity reflects what readers actually want to do with books — capture sentences they want to revisit.',
    ),

    # 10. CONTACT ROLODEX
    Precedent(
        slug='contact-rolodex',
        app_name='Contacts',
        domain='personal contact management',
        sentence='Track people I know — how I met them, when we last talked, anything I want to remember.',
        branding_id='paper',
        entities=[
            Entity('contact', 'Contact', 'Add a contact.',
                   fields=[
                       f('name', 'text', required=True),
                       f('relationship', 'choice', options=['family', 'close-friend', 'friend', 'colleague', 'former-colleague', 'mentor', 'mentee', 'professional', 'acquaintance']),
                       f('email', 'text'),
                       f('phone', 'text'),
                       f('city', 'text'),
                       f('met_at', 'date'),
                       f('met_how', 'text'),
                       f('birthday', 'date'),
                       f('notes', 'long-text'),
                       f('do_not_contact', 'yes-no'),
                   ],
                   list_columns=['name', 'relationship', 'city', 'met_at']),
            Entity('interaction', 'Interaction', 'Log a conversation or interaction.',
                   fields=[
                       f('contact', 'link-to', linkTo='contact', required=True),
                       f('happened_at', 'date', required=True),
                       f('kind', 'choice', options=['call', 'in-person', 'email', 'message', 'letter', 'card']),
                       f('topic', 'text'),
                       f('notes', 'long-text'),
                   ],
                   default_sort={'field': 'happened_at', 'direction': 'desc'}),
        ],
        narrative='Personal contacts apps fail by trying to be CRMs. The contact entity captures who they are; the interaction entity captures when you last talked. Met-how is the field that turns a name into a memory. Birthday is the field that turns an acquaintance into a friend. Do-not-contact is the field that respects boundaries.',
    ),

    # 11. PROJECT LOG
    Precedent(
        slug='project-log',
        app_name='Project Log',
        domain='small-project tracking',
        sentence="Track the projects I'm working on — tasks, who owes what, what's blocking, what's done.",
        branding_id='foundation-cyan',
        entities=[
            Entity('project', 'Project', 'Open a project.',
                   fields=[
                       f('name', 'text', required=True),
                       f('description', 'long-text'),
                       f('started_at', 'date'),
                       f('target_at', 'date'),
                       f('status', 'choice', options=['planning', 'active', 'paused', 'completed', 'cancelled']),
                       f('notes', 'long-text'),
                   ]),
            Entity('task', 'Task', 'Add a task.',
                   fields=[
                       f('project', 'link-to', linkTo='project', required=True),
                       f('title', 'text', required=True),
                       f('description', 'long-text'),
                       f('assigned_to', 'text'),
                       f('due_at', 'date'),
                       f('status', 'choice', options=['todo', 'in-progress', 'blocked', 'done', 'cancelled']),
                       f('blocked_by', 'long-text'),
                       f('notes', 'long-text'),
                   ],
                   list_columns=['title', 'project', 'status', 'due_at'],
                   default_sort={'field': 'due_at', 'direction': 'asc'}),
        ],
        narrative='Project logs are for the patron who needs more than a todo list but less than Jira. Project + task is the smallest useful decomposition. Blocked-by as a free-text field beats a structured blocker-link at this scale — the patron writes a sentence and moves on. Status enums for both project and task capture realistic stalls (paused, blocked) without over-engineering.',
    ),

    # 12. HOUSEHOLD MAINTENANCE
    Precedent(
        slug='household-maintenance',
        app_name='Home Care',
        domain='household maintenance',
        sentence='Track stuff in the house that needs maintenance — filters, batteries, service appointments.',
        branding_id='stone',
        entities=[
            Entity('item', 'Item', 'Add a maintenance item.',
                   fields=[
                       f('name', 'text', required=True),
                       f('location', 'text', describes='Kitchen, garage, attic, etc.'),
                       f('kind', 'choice', options=['filter', 'battery', 'appliance', 'system', 'consumable', 'other']),
                       f('install_at', 'date'),
                       f('replace_every_months', 'number'),
                       f('last_serviced_at', 'date'),
                       f('next_due_at', 'date'),
                       f('notes', 'long-text'),
                   ],
                   list_columns=['name', 'location', 'next_due_at', 'kind'],
                   default_sort={'field': 'next_due_at', 'direction': 'asc'}),
            Entity('service_log', 'Service log', 'Log a service action.',
                   fields=[
                       f('item', 'link-to', linkTo='item', required=True),
                       f('serviced_at', 'date', required=True),
                       f('action', 'choice', options=['replaced', 'cleaned', 'repaired', 'inspected']),
                       f('cost', 'money'),
                       f('serviced_by', 'text'),
                       f('notes', 'long-text'),
                   ]),
        ],
        narrative='Home maintenance is about not-forgetting. Item + service-log lets the patron see when something was last touched. Next-due-at + replace-every-months together let the renderer surface what is overdue. The pattern beats calendar reminders because the schema lives with the thing being maintained, not with a date.',
    ),

    # 13. PHOTO METADATA
    Precedent(
        slug='photo-metadata',
        app_name='Photo Notes',
        domain='photo organization and notes',
        sentence='Catalog photos — when and where they were taken, who is in them, what the story is.',
        branding_id='stone',
        entities=[
            Entity('photo', 'Photo', 'Catalog a photo.',
                   fields=[
                       f('title', 'text', required=True),
                       f('taken_on', 'date'),
                       f('location', 'text'),
                       f('photographer', 'text'),
                       f('story', 'long-text', describes='What was happening when this was taken?'),
                       f('roll_or_album', 'text'),
                       f('physical_location', 'text', describes='Where is the print or negative now?'),
                       f('digital_path', 'text'),
                   ],
                   list_columns=['title', 'taken_on', 'location', 'photographer']),
            Entity('person_in_photo', 'Person in photo', 'Tag a person in a photo.',
                   fields=[
                       f('photo', 'link-to', linkTo='photo', required=True),
                       f('person_name', 'text', required=True),
                       f('relationship', 'text'),
                       f('notes', 'long-text'),
                   ],
                   plural='people in photos'),
        ],
        narrative='Family photo organization fails when the metadata is reduced to EXIF. The patron wants to capture *story* (what was happening) and *people* (who is in it, what was their relationship). The physical-vs-digital location split matters because most patrons inherit boxes of prints alongside their digital archive.',
    ),

    # 14. LIVESTOCK RECORDS
    Precedent(
        slug='livestock-records',
        app_name='Livestock Records',
        domain='small-farm animal records',
        sentence='Track animals on the farm — births, breeding, vet, feed, sales.',
        branding_id='cool-spring',
        entities=[
            Entity('animal', 'Animal', 'Add an animal.',
                   fields=[
                       f('tag', 'text', required=True, describes='Ear tag or ID.'),
                       f('name', 'text'),
                       f('species', 'choice', options=['cattle', 'sheep', 'goat', 'pig', 'chicken', 'duck', 'turkey', 'rabbit', 'other']),
                       f('breed', 'text'),
                       f('sex', 'choice', options=['male', 'female']),
                       f('born_on', 'date'),
                       f('sire_tag', 'text'),
                       f('dam_tag', 'text'),
                       f('status', 'choice', options=['active', 'sold', 'butchered', 'died']),
                       f('notes', 'long-text'),
                   ],
                   list_columns=['tag', 'species', 'breed', 'sex', 'born_on', 'status'],
                   default_sort={'field': 'born_on', 'direction': 'desc'}),
            Entity('vet_visit', 'Vet visit', 'Log a vet visit.',
                   fields=[
                       f('animal', 'link-to', linkTo='animal', required=True),
                       f('visited_at', 'date', required=True),
                       f('reason', 'text', required=True),
                       f('treatment', 'long-text'),
                       f('vet_name', 'text'),
                       f('cost', 'money'),
                   ]),
            Entity('breeding_event', 'Breeding event', 'Record a breeding.',
                   fields=[
                       f('female', 'link-to', linkTo='animal', required=True),
                       f('male', 'link-to', linkTo='animal'),
                       f('bred_on', 'date', required=True),
                       f('expected_birth_at', 'date'),
                       f('outcome', 'choice', options=['pending', 'birthed', 'lost', 'no-take']),
                       f('notes', 'long-text'),
                   ]),
            Entity('sale', 'Sale', 'Record a sale.',
                   fields=[
                       f('animal', 'link-to', linkTo='animal', required=True),
                       f('sold_at', 'date', required=True),
                       f('buyer', 'text'),
                       f('price', 'money', required=True),
                       f('weight_lbs', 'number'),
                       f('notes', 'long-text'),
                   ]),
        ],
        narrative='Livestock records have legal and economic stakes. Tag is required because the regulatory requirement is per-animal. Sire/dam by tag (not by link) keeps lineage navigable even when the parents have left the herd. Breeding events are first-class — a small farm runs on them. Status enum tracks the realistic dispositions including non-sale exits.',
    ),

    # 15. PRAYER LIST
    Precedent(
        slug='prayer-list',
        app_name='Prayer List',
        domain='personal prayer practice',
        sentence='Keep a list of people and things to pray for — when I added them, when answered.',
        branding_id='paper',
        entities=[
            Entity('request', 'Request', 'Add a prayer request.',
                   fields=[
                       f('subject', 'text', required=True),
                       f('description', 'long-text'),
                       f('added_at', 'date', required=True),
                       f('category', 'choice', options=['family', 'friend', 'church', 'community', 'world', 'personal', 'thanksgiving']),
                       f('priority', 'choice', options=['ongoing', 'urgent', 'lift-up']),
                       f('answered_at', 'date'),
                       f('answer_notes', 'long-text'),
                   ],
                   list_columns=['subject', 'category', 'added_at', 'priority'],
                   default_sort={'field': 'added_at', 'direction': 'desc'}),
        ],
        narrative='Prayer lists are deeply personal. The simplest schema (one entity, modest fields) respects that. Answered-at + answer-notes capture the gratitude practice that distinguishes a prayer list from a worry list. Category enables prayer-by-context (morning family, weekly community). The patron likely never asked for more entities; they would feel they were being managed.',
    ),
]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for p in PRECEDENTS:
        write_precedent(p)
    print(f'wrote {len(PRECEDENTS)} precedents to {OUT_DIR}')
    # Sanity: every directory has both files.
    for p in PRECEDENTS:
        for name in ('schema.json', 'narrative.md'):
            f = OUT_DIR / p.slug / name
            assert f.exists(), f'missing {f}'
    print('all files present')


if __name__ == '__main__':
    main()
