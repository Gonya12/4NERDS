export type BulkReviewPhotoItem = {
  id: string;
  imageUrl?: string;
  imagePath?: string;
  officialCardImageUrl?: string;
};

export type BulkReviewPhotoRecord = {
  id: string;
  itemId: string;
  previewUrl?: string;
  providerImageUrl?: string;
};

export function bulkReviewSourceImage(item: BulkReviewPhotoItem, record: BulkReviewPhotoRecord) {
  return item.imageUrl || record.previewUrl;
}

export function bulkReviewProviderImage(item: BulkReviewPhotoItem, record: BulkReviewPhotoRecord) {
  return item.officialCardImageUrl || record.providerImageUrl;
}
