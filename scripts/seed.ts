/**
 * Synthetic dataset generator + DB seeder.
 *
 * Design goals (see plan §5):
 *   • 3 months ending today (window: 2026-02-10 → 2026-05-10).
 *   • Total expense ∈ [PKR 200,000, 300,000]. Target midpoint PKR 240,000.
 *   • Realistic Pakistani spending behaviour: merchants, weekday/weekend effects,
 *     salary cycles, monthly bills, occasional anomalies, one missed savings transfer.
 *   • Deterministic via fixed Faker seed → demo is reproducible.
 */
import { faker } from "@faker-js/faker"
import { PrismaClient } from "@prisma/client"
import { CATEGORIES } from "../src/lib/finance/constants"

const prisma = new PrismaClient()
faker.seed(20260510)

// -------- helpers --------
const r = (min: number, max: number) =>
  Math.round(faker.number.float({ min, max, fractionDigits: 0 }))
const choice = <T>(xs: T[]): T => xs[Math.floor(faker.number.float({ min: 0, max: xs.length - 0.001 }))]
const weekday = (d: Date) => d.getDay()
const isWeekend = (d: Date) => weekday(d) === 5 || weekday(d) === 6 // Pakistan workweek: Sat/Sun off

const MERCHANTS: Record<string, string[]> = {
  groceries: ["Imtiaz Super Market", "Al-Fatah", "Naheed Supermarket", "Carrefour Lahore", "Springs Mart"],
  fuel: ["PSO Gulberg", "Shell Cantt", "Total Parco DHA", "Attock Petroleum"],
  utilities: ["LESCO Bill", "SNGPL Gas Bill", "WASA Water Bill", "K-Electric"],
  internet_mobile: ["StormFiber Monthly", "Nayatel Monthly", "Jazz Postpaid", "Zong Bundle"],
  food_delivery: [
    "Foodpanda - Cheezious",
    "Foodpanda - KFC",
    "Foodpanda - OPTP",
    "Foodpanda - Howdy",
    "Foodpanda - Pizza Hut",
    "Foodpanda - Subway",
    "Foodpanda - Karahi Boys",
  ],
  dine_out: ["Monal Lahore", "Cafe Aylanto", "Bundu Khan", "Salt'n Pepper", "Cafe Zouk"],
  transport: ["Careem Ride", "inDrive Ride", "Bykea Ride", "Uber"],
  subscriptions: ["Netflix Pakistan", "Spotify Premium", "ChatGPT Plus", "YouTube Premium"],
  university: ["FAST University Tuition", "FAST Lab Fee", "FAST Books"],
  online_shopping: ["Daraz.pk", "AliExpress", "Khaadi Online", "Ego Online", "Diners.pk"],
  healthcare: ["Shaukat Khanum Lab", "Servaid Pharmacy", "Dawa.pk", "MedixMall"],
  family_support: ["JazzCash to Mom", "Easypaisa to Family", "Bank Transfer - Father"],
  entertainment: ["Cinepax DHA", "Steam Wallet", "PlayStation Store", "Xbox Live"],
  personal_care: ["Saloon Visit", "Gold's Gym", "Body Shop", "Vitamin Supplements"],
  charity: ["Edhi Foundation", "Saylani Welfare", "Local Mosque"],
  salary: ["Monthly Salary"],
  freelance: ["Upwork Withdrawal", "Local Client Payment"],
  savings_transfer: ["Transfer to Savings Account"],
  anomaly: ["Daraz Big Purchase", "Hospital Emergency", "Wedding Gift", "Phone Repair"],
}

const NOTES_BY_CAT: Record<string, string[]> = {
  groceries: ["Weekly groceries", "Bought essentials", "Eid prep groceries", "Ramzan iftar items"],
  food_delivery: ["Friday cheat day", "Late-night order", "Weekend dinner", "Office lunch", "Birthday celebration"],
  dine_out: ["Family dinner", "Friends meet-up", "Birthday dinner", "Eid hangout"],
  university: ["Spring semester fee paid", "Lab fee", "Books for NLP / AI courses"],
  family_support: ["Monthly send-home", "Help for parents"],
  online_shopping: ["Eid clothes", "Electronics", "Daraz sale buy", "Skincare order"],
  healthcare: ["Medicine refill", "Lab test", "Dentist visit"],
  charity: ["Monthly zakat", "Mosque donation"],
  anomaly: ["Big unplanned purchase", "Emergency expense"],
  utilities: ["Monthly bill"],
  internet_mobile: ["Monthly internet", "Mobile postpaid bill"],
  fuel: ["Filled tank", "Weekly fuel"],
  transport: ["Ride to uni", "Late-night ride home", "To office"],
  subscriptions: ["Auto-renew"],
  entertainment: ["Movie night", "Gaming"],
  personal_care: ["Self-care"],
  salary: ["Monthly salary credited"],
  freelance: ["Freelance project payout"],
  savings_transfer: ["Routine savings transfer"],
}

// -------- data plan --------
const START = new Date("2026-02-10T00:00:00")
const END = new Date("2026-05-10T23:59:59")
const MONTHLY_INCOME = 120_000
const dateInRange = (from: Date, to: Date) =>
  new Date(faker.date.between({ from, to }).setHours(r(8, 22), r(0, 59), 0, 0))

// salary cycles: credit on the 1st (within window: Mar 1, Apr 1, May 1)
const salaryDates = [new Date("2026-03-01"), new Date("2026-04-01"), new Date("2026-05-01")]

// monthly recurring bills: utilities, internet, subscriptions
function recurringBills(monthAnchor: Date): Array<{ date: Date; cat: string; amount: number; merchant: string; desc: string }> {
  const y = monthAnchor.getFullYear()
  const m = monthAnchor.getMonth()
  return [
    { date: new Date(y, m, 7, 12), cat: "utilities", amount: r(4500, 6500), merchant: "LESCO Bill", desc: "Electricity bill" },
    { date: new Date(y, m, 9, 12), cat: "utilities", amount: r(2200, 3500), merchant: "SNGPL Gas Bill", desc: "Gas bill" },
    { date: new Date(y, m, 11, 12), cat: "utilities", amount: r(700, 1200), merchant: "WASA Water Bill", desc: "Water bill" },
    { date: new Date(y, m, 5, 12), cat: "internet_mobile", amount: r(2400, 3200), merchant: "StormFiber Monthly", desc: "Home internet" },
    { date: new Date(y, m, 18, 12), cat: "internet_mobile", amount: r(800, 1500), merchant: "Jazz Postpaid", desc: "Mobile bill" },
    { date: new Date(y, m, 2, 12), cat: "subscriptions", amount: 1100, merchant: "Netflix Pakistan", desc: "Auto-renew" },
    { date: new Date(y, m, 14, 12), cat: "subscriptions", amount: 499, merchant: "Spotify Premium", desc: "Auto-renew" },
    { date: new Date(y, m, 21, 12), cat: "subscriptions", amount: 5500, merchant: "ChatGPT Plus", desc: "Auto-renew (USD billed)" },
  ]
}

// daily small spends (food delivery, transport) — tuned to keep 3-month total ~240k
function dailyMicroSpends(date: Date): Array<{ cat: string; amount: number; merchant: string; desc: string }> {
  const out: Array<{ cat: string; amount: number; merchant: string; desc: string }> = []
  const wknd = isWeekend(date)
  // food delivery: weekends ~50% chance of 1 order; weekdays ~20% chance
  const fdProb = wknd ? 0.55 : 0.18
  if (faker.number.float({ min: 0, max: 1 }) < fdProb) {
    out.push({
      cat: "food_delivery",
      amount: r(450, 1500),
      merchant: choice(MERCHANTS.food_delivery),
      desc: choice(NOTES_BY_CAT.food_delivery),
    })
  }
  // transport: weekday ~35% chance of one ride; weekend lower
  const trProb = wknd ? 0.15 : 0.35
  if (faker.number.float({ min: 0, max: 1 }) < trProb) {
    out.push({
      cat: "transport",
      amount: r(180, 650),
      merchant: choice(MERCHANTS.transport),
      desc: choice(NOTES_BY_CAT.transport),
    })
  }
  return out
}

async function main() {
  console.log("Resetting tables…")
  await prisma.message.deleteMany()
  await prisma.conversation.deleteMany()
  await prisma.savingsGoal.deleteMany()
  await prisma.transaction.deleteMany()
  await prisma.account.deleteMany()
  await prisma.userProfile.deleteMany()
  await prisma.category.deleteMany()
  await prisma.user.deleteMany()
  // Reset SQLite autoincrement counters so demo user always has id=1
  await prisma.$executeRawUnsafe(`DELETE FROM sqlite_sequence`)

  console.log("Seeding categories…")
  const categoryRows = await Promise.all(
    CATEGORIES.map((c) =>
      prisma.category.create({
        data: { name: c.name, parent: c.parent, isEssential: c.isEssential, isHighRisk: c.isHighRisk },
      }),
    ),
  )
  const catId = (name: string) => categoryRows.find((c) => c.name === name)!.id

  console.log("Seeding user + profile + accounts…")
  const user = await prisma.user.create({
    data: {
      id: 1,
      email: "abdullah@example.pk",
      name: "Abdullah",
      profile: {
        create: {
          monthlyIncome: MONTHLY_INCOME,
          emergencyFundTarget: 240_000,
          riskTolerance: "medium",
          dependents: 1,
          notesAboutSelf:
            "8th-semester FAST student, lives in Lahore, supports mother monthly via JazzCash, dislikes interest-based installments, saving for an iPhone 15.",
        },
      },
      accounts: {
        create: [
          { name: "Main Account (Meezan)", type: "checking", balance: 0 },
          { name: "Savings Account", type: "savings", balance: 0 },
          { name: "Cash Wallet", type: "cash", balance: 4_000 },
        ],
      },
    },
    include: { accounts: true },
  })
  const main = user.accounts.find((a) => a.type === "checking")!
  const savings = user.accounts.find((a) => a.type === "savings")!

  // ---------- generate transactions ----------
  console.log("Generating transactions…")
  type Tx = {
    date: Date
    accountId: number
    categoryId: number | null
    amount: number
    type: "income" | "expense" | "transfer"
    merchant: string | null
    description: string | null
    isAnomaly: boolean
  }
  const txs: Tx[] = []

  // 1. salary credits
  for (const d of salaryDates) {
    txs.push({
      date: d,
      accountId: main.id,
      categoryId: catId("salary"),
      amount: MONTHLY_INCOME,
      type: "income",
      merchant: "Monthly Salary",
      description: "Monthly salary credited",
      isAnomaly: false,
    })
  }
  // bonus freelance income (March)
  txs.push({
    date: new Date("2026-03-18T14:30"),
    accountId: main.id,
    categoryId: catId("freelance"),
    amount: 25_000,
    type: "income",
    merchant: "Upwork Withdrawal",
    description: "Freelance NLP labelling project payout",
    isAnomaly: false,
  })

  // 2. recurring monthly bills (Feb partial + Mar + Apr; May has only utilities so far)
  for (const anchor of [new Date(2026, 1, 1), new Date(2026, 2, 1), new Date(2026, 3, 1), new Date(2026, 4, 1)]) {
    for (const b of recurringBills(anchor)) {
      if (b.date >= START && b.date <= END) {
        txs.push({
          date: b.date,
          accountId: main.id,
          categoryId: catId(b.cat),
          amount: -b.amount,
          type: "expense",
          merchant: b.merchant,
          description: b.desc,
          isAnomaly: false,
        })
      }
    }
  }

  // 3. weekly groceries (~one per week, Saturday)
  for (let day = new Date(START); day <= END; day = new Date(day.getTime() + 24 * 3600 * 1000)) {
    if (weekday(day) === 6 && faker.number.float({ min: 0, max: 1 }) < 0.6) {
      txs.push({
        date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), r(11, 20), r(0, 59)),
        accountId: main.id,
        categoryId: catId("groceries"),
        amount: -r(2200, 3800),
        type: "expense",
        merchant: choice(MERCHANTS.groceries),
        description: choice(NOTES_BY_CAT.groceries),
        isAnomaly: false,
      })
    }
  }

  // 4. fuel (~bi-weekly, Tue/Fri)
  for (let day = new Date(START); day <= END; day = new Date(day.getTime() + 24 * 3600 * 1000)) {
    if ((weekday(day) === 2 || weekday(day) === 5) && faker.number.float({ min: 0, max: 1 }) < 0.28) {
      txs.push({
        date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), r(8, 21), r(0, 59)),
        accountId: main.id,
        categoryId: catId("fuel"),
        amount: -r(1900, 3000),
        type: "expense",
        merchant: choice(MERCHANTS.fuel),
        description: choice(NOTES_BY_CAT.fuel),
        isAnomaly: false,
      })
    }
  }

  // 5. daily micro-spends
  for (let day = new Date(START); day <= END; day = new Date(day.getTime() + 24 * 3600 * 1000)) {
    for (const m of dailyMicroSpends(day)) {
      txs.push({
        date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), r(11, 23), r(0, 59)),
        accountId: main.id,
        categoryId: catId(m.cat),
        amount: -m.amount,
        type: "expense",
        merchant: m.merchant,
        description: m.desc,
        isAnomaly: false,
      })
    }
  }

  // 6. dine-out (1-2/month)
  for (const anchor of [new Date(2026, 1, 15), new Date(2026, 2, 15), new Date(2026, 3, 15)]) {
    const n = r(1, 2)
    for (let i = 0; i < n; i++) {
      const d = dateInRange(new Date(anchor.getFullYear(), anchor.getMonth(), 1), new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0))
      if (d < START || d > END) continue
      txs.push({
        date: d,
        accountId: main.id,
        categoryId: catId("dine_out"),
        amount: -r(900, 2400),
        type: "expense",
        merchant: choice(MERCHANTS.dine_out),
        description: choice(NOTES_BY_CAT.dine_out),
        isAnomaly: false,
      })
    }
  }

  // 7. online shopping (1/month, occasional 2)
  for (const anchor of [new Date(2026, 1, 15), new Date(2026, 2, 15), new Date(2026, 3, 15)]) {
    const n = r(1, 2)
    for (let i = 0; i < n; i++) {
      const d = dateInRange(new Date(anchor.getFullYear(), anchor.getMonth(), 1), new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0))
      if (d < START || d > END) continue
      txs.push({
        date: d,
        accountId: main.id,
        categoryId: catId("online_shopping"),
        amount: -r(1200, 4500),
        type: "expense",
        merchant: choice(MERCHANTS.online_shopping),
        description: choice(NOTES_BY_CAT.online_shopping),
        isAnomaly: false,
      })
    }
  }

  // 8. family support (monthly, ~10k)
  for (const anchor of [new Date(2026, 1, 12), new Date(2026, 2, 4), new Date(2026, 3, 5), new Date(2026, 4, 4)]) {
    if (anchor < START || anchor > END) continue
    txs.push({
      date: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 10, 30),
      accountId: main.id,
      categoryId: catId("family_support"),
      amount: -r(8000, 12000),
      type: "expense",
      merchant: choice(MERCHANTS.family_support),
      description: "Monthly send-home for mother",
      isAnomaly: false,
    })
  }

  // 9. healthcare (sparse, 1-2 across window)
  const healthcareCount = r(1, 2)
  for (let i = 0; i < healthcareCount; i++) {
    const d = dateInRange(START, END)
    txs.push({
      date: d,
      accountId: main.id,
      categoryId: catId("healthcare"),
      amount: -r(800, 2500),
      type: "expense",
      merchant: choice(MERCHANTS.healthcare),
      description: choice(NOTES_BY_CAT.healthcare),
      isAnomaly: false,
    })
  }

  // 10. entertainment (1/month avg)
  for (let i = 0; i < r(2, 3); i++) {
    const d = dateInRange(START, END)
    txs.push({
      date: d,
      accountId: main.id,
      categoryId: catId("entertainment"),
      amount: -r(800, 2200),
      type: "expense",
      merchant: choice(MERCHANTS.entertainment),
      description: choice(NOTES_BY_CAT.entertainment),
      isAnomaly: false,
    })
  }

  // 11. personal_care
  for (let i = 0; i < r(2, 3); i++) {
    const d = dateInRange(START, END)
    txs.push({
      date: d,
      accountId: main.id,
      categoryId: catId("personal_care"),
      amount: -r(700, 1800),
      type: "expense",
      merchant: choice(MERCHANTS.personal_care),
      description: choice(NOTES_BY_CAT.personal_care),
      isAnomaly: false,
    })
  }

  // 12. charity (monthly, often skipped)
  for (const anchor of [new Date(2026, 2, 28), new Date(2026, 3, 28)]) {
    if (anchor < START || anchor > END) continue
    if (faker.number.float({ min: 0, max: 1 }) < 0.7) {
      txs.push({
        date: anchor,
        accountId: main.id,
        categoryId: catId("charity"),
        amount: -r(2000, 6000),
        type: "expense",
        merchant: choice(MERCHANTS.charity),
        description: choice(NOTES_BY_CAT.charity),
        isAnomaly: false,
      })
    }
  }

  // 13. UNIVERSITY: spring semester fee in March (one big hit)
  txs.push({
    date: new Date("2026-03-12T11:30"),
    accountId: main.id,
    categoryId: catId("university"),
    amount: -38_500,
    type: "expense",
    merchant: "FAST University Tuition",
    description: "Spring 2026 semester fee paid",
    isAnomaly: false,
  })
  // small lab fee in April
  txs.push({
    date: new Date("2026-04-08T10:00"),
    accountId: main.id,
    categoryId: catId("university"),
    amount: -2_500,
    type: "expense",
    merchant: "FAST Lab Fee",
    description: "Lab fee — NLP project resources",
    isAnomaly: false,
  })

  // 14. ANOMALIES
  txs.push({
    date: new Date("2026-04-22T22:14"),
    accountId: main.id,
    categoryId: catId("anomaly"),
    amount: -14_800,
    type: "expense",
    merchant: "Daraz.pk",
    description: "Impulse buy — premium leather backpack on Daraz sale",
    isAnomaly: true,
  })
  txs.push({
    date: new Date("2026-03-04T14:08"),
    accountId: main.id,
    categoryId: catId("anomaly"),
    amount: -7_200,
    type: "expense",
    merchant: "Shaukat Khanum Lab",
    description: "Unexpected medical lab tests",
    isAnomaly: true,
  })

  // 15. SAVINGS TRANSFERS — monthly, with one missed (April → realistic anomaly the bot can flag)
  const savingsTransfers = [
    { date: new Date("2026-03-03T09:00"), amount: 18000 },
    // April skipped on purpose (the user got hit by university fee + Daraz spike)
    { date: new Date("2026-05-03T09:00"), amount: 22000 },
  ]
  for (const t of savingsTransfers) {
    txs.push({
      date: t.date,
      accountId: main.id,
      categoryId: catId("savings_transfer"),
      amount: -t.amount,
      type: "transfer",
      merchant: "Transfer to Savings Account",
      description: "Monthly savings transfer",
      isAnomaly: false,
    })
    txs.push({
      date: t.date,
      accountId: savings.id,
      categoryId: catId("savings_transfer"),
      amount: +t.amount,
      type: "transfer",
      merchant: "From Main Account",
      description: "Monthly savings transfer",
      isAnomaly: false,
    })
  }

  // ---------- write transactions ----------
  txs.sort((a, b) => a.date.getTime() - b.date.getTime())
  await prisma.transaction.createMany({
    data: txs.map((t) => ({
      userId: user.id,
      accountId: t.accountId,
      categoryId: t.categoryId,
      date: t.date,
      amount: t.amount,
      type: t.type,
      merchant: t.merchant,
      description: t.description,
      isAnomaly: t.isAnomaly,
    })),
  })

  // ---------- balances ----------
  const mainBal = txs
    .filter((t) => t.accountId === main.id)
    .reduce((s, t) => s + t.amount, 0)
  const savingsBal = txs
    .filter((t) => t.accountId === savings.id)
    .reduce((s, t) => s + t.amount, 0)
  await prisma.account.update({ where: { id: main.id }, data: { balance: mainBal } })
  await prisma.account.update({ where: { id: savings.id }, data: { balance: savingsBal } })

  // ---------- savings goals ----------
  await prisma.savingsGoal.createMany({
    data: [
      {
        userId: user.id,
        name: "iPhone 15",
        targetAmount: 320_000,
        targetDate: new Date("2026-12-01"),
        currentAmount: Math.max(0, savingsBal),
      },
      {
        userId: user.id,
        name: "Emergency Fund",
        targetAmount: 240_000,
        targetDate: new Date("2026-09-01"),
        currentAmount: Math.max(0, Math.floor(savingsBal * 0.0)),
      },
    ],
  })

  // ---------- sanity check ----------
  const totalExpense = txs
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + Math.abs(t.amount), 0)
  console.log(`Total transactions: ${txs.length}`)
  console.log(`Total expense over 3 months: PKR ${totalExpense.toLocaleString("en-PK")}`)
  if (totalExpense < 200_000 || totalExpense > 300_000) {
    throw new Error(
      `Total expense ${totalExpense} is outside [200k, 300k]. Adjust seed numbers before using this dataset.`,
    )
  } else {
    console.log("✔ Total expense within target range [200k, 300k].")
  }
  console.log(`Main balance: PKR ${mainBal.toLocaleString("en-PK")}`)
  console.log(`Savings balance: PKR ${savingsBal.toLocaleString("en-PK")}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
