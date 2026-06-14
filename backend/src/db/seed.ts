/**
 * Seed script — registers all 6 flatmates + creates the "Flat 4B" group
 * Run once: npx tsx src/db/seed.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { db } from "./index";
import { users, groups, groupMemberships } from "./schema";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

const MEMBERS = [
  { name: "Aisha",  email: "aisha@flat4b.dev",  joinedAt: "2026-02-01", leftAt: null },
  { name: "Rohan",  email: "rohan@flat4b.dev",  joinedAt: "2026-02-01", leftAt: null },
  { name: "Priya",  email: "priya@flat4b.dev",  joinedAt: "2026-02-01", leftAt: null },
  { name: "Meera",  email: "meera@flat4b.dev",  joinedAt: "2026-02-01", leftAt: "2026-03-31" },
  { name: "Dev",    email: "dev@flat4b.dev",    joinedAt: "2026-02-08", leftAt: null },
  { name: "Sam",    email: "sam@flat4b.dev",    joinedAt: "2026-04-08", leftAt: null },
];

const DEFAULT_PASSWORD = "password123";

async function seed() {
  console.log("🌱 Seeding flatmates...");
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const createdUsers: { id: number; name: string }[] = [];

  for (const m of MEMBERS) {
    // upsert by email
    const existing = await db.select().from(users).where(eq(users.email, m.email)).limit(1);
    if (existing.length > 0) {
      console.log(`  ✓ ${m.name} already exists`);
      createdUsers.push({ id: existing[0].id, name: m.name });
    } else {
      const [u] = await db.insert(users).values({ name: m.name, email: m.email, passwordHash }).returning({ id: users.id, name: users.name });
      console.log(`  + Created ${m.name} (id=${u.id})`);
      createdUsers.push(u);
    }
  }

  // Create group "Flat 4B" owned by Aisha
  const aishaId = createdUsers.find(u => u.name === "Aisha")!.id;
  let groupId: number;

  const existingGroup = await db.select().from(groups).where(eq(groups.name, "Flat 4B")).limit(1);
  if (existingGroup.length > 0) {
    groupId = existingGroup[0].id;
    console.log(`  ✓ Group "Flat 4B" already exists (id=${groupId})`);
  } else {
    const [g] = await db.insert(groups).values({
      name: "Flat 4B",
      description: "Shared apartment — Feb to Apr 2026",
      createdBy: aishaId,
    }).returning({ id: groups.id });
    groupId = g.id;
    console.log(`  + Created group "Flat 4B" (id=${groupId})`);
  }

  // Add memberships with correct join/leave dates
  for (let i = 0; i < MEMBERS.length; i++) {
    const m = MEMBERS[i];
    const userId = createdUsers[i].id;

    const existing = await db.select().from(groupMemberships)
      .where(eq(groupMemberships.groupId, groupId))
      .limit(100);

    const alreadyMember = existing.some(mem => mem.userId === userId);
    if (!alreadyMember) {
      await db.insert(groupMemberships).values({
        groupId,
        userId,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt,
      });
      console.log(`  + Added ${m.name} to group (joined ${m.joinedAt}${m.leftAt ? `, left ${m.leftAt}` : ""})`);
    } else {
      console.log(`  ✓ ${m.name} already in group`);
    }
  }

  console.log(`\n✅ Seed complete!`);
  console.log(`\n📋 Login credentials (all use password: ${DEFAULT_PASSWORD})`);
  for (const m of MEMBERS) {
    console.log(`   ${m.name.padEnd(8)} → ${m.email}`);
  }
  console.log(`\n🏠 Group ID: ${groupId}`);
  console.log(`   Visit: http://localhost:5173/groups/${groupId}`);

  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
