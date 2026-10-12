import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/chat/tools';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  const id = Number.parseInt(rawId, 10);

  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: 'Invalid transaction ID' }, { status: 400 });
  }

  const transaction = await prisma.transaction.findFirst({
    where: { id, userId: DEMO_USER_ID },
    include: { category: true, account: true },
  });

  if (!transaction) {
    return Response.json({ error: 'Transaction not found' }, { status: 404 });
  }

  return Response.json(transaction);
}
