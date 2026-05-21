# Club Roster

**Domain:** small-club membership

**Patron-style sentence:**

> Track our club members, their dues, who showed up to which meetings.

**Why these entities, not others:**

Clubs need three intersecting records: who belongs (member), what we did (meeting), who showed up (attendance). Dues are a separate stream because they often run on a different schedule than meetings. Status enum captures the realistic states small clubs run on, including "lapsed" — most rosters need it but rarely have it.
