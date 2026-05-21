# Service Tickets

**Domain:** service-and-repair operations

**Patron-style sentence:**

> Track service tickets — customer, vehicle (or item), problem, parts used, technician, completed.

**Why these entities, not others:**

Service operations live on the ticket. Customer and item are stable; ticket is event-shaped; parts-used is a many-to-many between tickets and parts. Status enum covers the operational lifecycle including the often-missed "waiting on parts" stall state. Priority makes triage practical.
