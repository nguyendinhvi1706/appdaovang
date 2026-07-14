-- CreateEnum
CREATE TYPE "SetupStatus" AS ENUM ('PENDING', 'RUNNING', 'WIN', 'LOSS', 'CANCELLED');

-- CreateTable
CREATE TABLE "AiSetup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "entry" DOUBLE PRECISION NOT NULL,
    "sl" DOUBLE PRECISION NOT NULL,
    "tp" DOUBLE PRECISION NOT NULL,
    "rr" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "status" "SetupStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggeredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "AiSetup_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AiSetup" ADD CONSTRAINT "AiSetup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
