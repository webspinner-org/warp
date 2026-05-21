# Project Log

**Domain:** small-project tracking

**Patron-style sentence:**

> Track the projects I'm working on — tasks, who owes what, what's blocking, what's done.

**Why these entities, not others:**

Project logs are for the patron who needs more than a todo list but less than Jira. Project + task is the smallest useful decomposition. Blocked-by as a free-text field beats a structured blocker-link at this scale — the patron writes a sentence and moves on. Status enums for both project and task capture realistic stalls (paused, blocked) without over-engineering.
