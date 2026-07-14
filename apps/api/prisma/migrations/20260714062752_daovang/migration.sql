-- CreateEnum
CREATE TYPE "SharedType" AS ENUM ('STRATEGY', 'TEMPLATE', 'INDICATOR', 'JOURNAL', 'BACKTEST');

-- CreateTable
CREATE TABLE "SharedItem" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" "SharedType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "SharedLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedLike_userId_itemId_key" ON "SharedLike"("userId", "itemId");

-- AddForeignKey
ALTER TABLE "SharedItem" ADD CONSTRAINT "SharedItem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedLike" ADD CONSTRAINT "SharedLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedLike" ADD CONSTRAINT "SharedLike_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SharedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
