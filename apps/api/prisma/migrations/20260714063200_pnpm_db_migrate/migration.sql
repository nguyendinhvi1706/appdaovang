-- CreateEnum
CREATE TYPE "MarketCategory" AS ENUM ('INDICATOR', 'EA', 'TEMPLATE', 'SCRIPT', 'AI_PROMPT', 'JOURNAL');

-- CreateTable
CREATE TABLE "MarketItem" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "category" "MarketCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketRating" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,

    CONSTRAINT "MarketRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketRating_userId_itemId_key" ON "MarketRating"("userId", "itemId");

-- AddForeignKey
ALTER TABLE "MarketItem" ADD CONSTRAINT "MarketItem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketRating" ADD CONSTRAINT "MarketRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketRating" ADD CONSTRAINT "MarketRating_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
