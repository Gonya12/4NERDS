export type RegistrationStatus = "open" | "closed" | "unknown" | "sold_out" | "waitlist";
export type Confidence = "high" | "medium" | "low";
export type SourceType = "website" | "event_page" | "rss" | "reddit" | "instagram_page" | "instagram_manual" | "facebook_page" | "manual" | "other";
export type ReviewStatus = "pending" | "saved" | "discarded";
export type AttendanceStatus = "interested" | "maybe" | "not_going" | "none";
export type EventClassification = "event_high_confidence" | "event_needs_review" | "possible_but_low_confidence" | "not_event";
export type TeamDecision = "interested" | "maybe" | "not_going";
export type EventStatus = "interested" | "registered" | "paid" | "preparing" | "completed" | "skipped" | "attended";
export type EventStage = "new" | "applied" | "paid" | "past";
export type SplitMode = "equal" | "weighted_by_days";
export type PricingType = "flat" | "per_day" | "package";
export type BuyItemPriority = "low" | "medium" | "high";
export type PokemonProductCategory = "raw_card" | "graded_card" | "sealed_product" | "pokemon_accessory" | "bulk_lot" | "other_pokemon_product";
export type PurchaseSource = "card_show" | "online" | "local" | "trade" | "personal_inventory" | "other";
export type SalePaymentMethod = "cash" | "zelle" | "venmo" | "cash_app" | "paypal" | "card" | "trade" | "other";
export type InventoryStatus = "in_stock" | "partially_sold" | "sold" | "personal" | "traded_out" | "removed" | "reversed";
export type CardCondition = "Mint" | "Near Mint / NM" | "Lightly Played / LP" | "Moderately Played / MP" | "Heavily Played / HP" | "Damaged" | "Unknown";
export type CardScanStatus = "not_scanned" | "analyzing" | "needs_review" | "ready_to_import" | "imported" | "failed";
export type CardGame = "pokemon" | "one_piece" | "other";
export type CardLanguage = "en" | "ja" | "unknown";
export type CardDataProvider = "pokemontcg" | "tcgdex" | "optcgapi" | "manual";
export type BusinessExpenseCategory = "event_table_fee" | "gas" | "tolls" | "parking" | "food" | "supplies" | "shipping" | "packaging" | "card_show_equipment" | "software_subscription" | "advertising" | "other";

export interface Organizer {
  id: string;
  name: string;
  instagramUrl?: string;
  websiteUrl?: string;
  facebookUrl?: string;
  redditUrl?: string;
  followerCount?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  sourceId?: string;
  organizerId?: string;
  name: string;
  description?: string;
  startDate: string;
  endDate?: string;
  timeText?: string;
  venueName?: string;
  address?: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  distanceMiles?: number;
  registrationStatus: RegistrationStatus;
  registrationUrl?: string;
  sourceUrl?: string;
  sourceType: SourceType;
  confidence: Confidence;
  needsReview: boolean;
  interested: boolean;
  maybe: boolean;
  notGoing: boolean;
  startTime?: string;
  endTime?: string;
  eventDays?: EventDay[];
  eventDayWorkers?: EventDayWorker[];
  priceOptions?: EventPriceOption[];
  splitMode?: SplitMode;
  imageUrl?: string;
  imagePath?: string;
  locationId?: string;
  locationInstagramHandle?: string;
  organizerInstagramHandle?: string;
  status?: EventStatus;
  eventStage?: EventStage;
  externalSource?: string;
  externalSourceId?: string;
  calendarFeedId?: string;
  importedFromCalendar?: boolean;
  manuallyEdited?: boolean;
  packingNotes?: string;
  boothNumber?: string;
  setupTime?: string;
  parkingNotes?: string;
  floorSection?: string;
  entryInstructions?: string;
  checklistItems?: EventChecklistItem[];
  finance?: EventFinance;
  liveNotes?: EventLiveNote[];
  salesCategories?: EventSalesCategory[];
  review?: EventReview;
  salesRecords?: SalesRecord[];
  confirmedWorkerIds?: string[];
  eventCost?: number;
  paymentRecords?: PaymentRecord[];
  reminderEnabled: boolean;
  reminderOffsets: number[];
  reminderNotificationIds: number[];
  lastRegistrationStatus?: RegistrationStatus;
  lastNotifiedRegistrationStatus?: RegistrationStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarFeed {
  id: string;
  name: string;
  icsUrl: string;
  enabled: boolean;
  autoImport: boolean;
  lastCheckedAt?: string;
  lastStatus?: string;
  lastError?: string;
  lastFoundCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarFeedEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end?: string;
  allDay: boolean;
  url?: string;
}

export interface CalendarImportCandidate extends CalendarFeedEvent {
  id: string;
  calendarFeedId: string;
  calendarFeedName: string;
  duplicate: boolean;
  reviewStatus: "pending" | "saved" | "ignored";
  createdAt: string;
}

export interface SalesRecord {
  id: string;
  eventId?: string;
  eventDayId?: string;
  imageUrl?: string;
  imagePath?: string;
  itemName?: string;
  category?: PokemonProductCategory;
  quantity: number;
  soldPrice?: number;
  boughtPrice?: number;
  marketValue?: number;
  marketPriceSource?: string;
  marketPriceVariant?: string;
  marketPriceUpdatedAt?: string;
  marketPriceCheckedAt?: string;
  tcgplayerUrl?: string;
  cardName?: string;
  collectorNumber?: string;
  cardSet?: string;
  cardSetId?: string;
  cardSetCode?: string;
  cardRarity?: string;
  cardLanguage?: string;
  cardGame?: CardGame;
  dataProvider?: CardDataProvider;
  providerCardId?: string;
  cardCode?: string;
  marketPriceCurrency?: string;
  cardCondition?: CardCondition;
  stickerPrice?: number;
  pokemonTcgCardId?: string;
  officialCardImageUrl?: string;
  boughtFrom?: string;
  purchaseSource?: PurchaseSource;
  paymentMethod?: SalePaymentMethod;
  soldByWorkerId?: string;
  isRawCard: boolean;
  buyPercentage?: number;
  targetBuyPrice?: number;
  inventoryPurchaseId?: string;
  financialTransactionId?: string;
  financialTransactionItemId?: string;
  notes?: string;
  soldAt: string;
  pendingUpload: boolean;
  createdAt: string;
  updatedAt: string;
  ownershipShares?: OwnershipShare[];
}

export interface InventoryPurchase {
  id: string;
  imageUrl?: string;
  imagePath?: string;
  itemName: string;
  category: PokemonProductCategory;
  quantity: number;
  quantitySold: number;
  purchaseDate: string;
  totalCost: number;
  costBasisKnown?: boolean;
  zeroCostBasisConfirmed?: boolean;
  marketValue?: number;
  providerBaseMarket?: number;
  marketPriceSource?: string;
  marketPriceVariant?: string;
  marketPriceUpdatedAt?: string;
  marketPriceCheckedAt?: string;
  isRawCard: boolean;
  buyPercentage?: number;
  targetBuyPrice?: number;
  purchaseSource?: PurchaseSource;
  seller?: string;
  eventId?: string;
  purchasedByWorkerId?: string;
  notes?: string;
  status: InventoryStatus;
  soldPrice?: number;
  soldDate?: string;
  soldByWorkerId?: string;
  soldEventId?: string;
  soldPaymentMethod?: SalePaymentMethod;
  buyerNote?: string;
  cardName?: string;
  collectorNumber?: string;
  cardSet?: string;
  cardSetId?: string;
  cardSetCode?: string;
  cardRarity?: string;
  cardLanguage?: string;
  cardGame?: CardGame;
  dataProvider?: CardDataProvider;
  providerCardId?: string;
  cardCode?: string;
  marketPriceCurrency?: string;
  pokemonTcgCardId?: string;
  officialCardImageUrl?: string;
  tcgplayerUrl?: string;
  cardCondition?: CardCondition;
  stickerPrice?: number;
  gradingCompany?: string;
  grade?: string;
  certificateNumber?: string;
  frontImageUrl?: string;
  frontImagePath?: string;
  backImageUrl?: string;
  backImagePath?: string;
  scanConfidence?: "high" | "medium" | "low";
  scanStatus?: CardScanStatus;
  imageHash?: string;
  scanResult?: Record<string, unknown>;
  acquisitionMethod?: "purchased" | "trade" | "manual_entry" | "existing_inventory_import" | "other";
  acquiredFinancialTransactionId?: string;
  disposedFinancialTransactionId?: string;
  tradedAt?: string;
  agreedTradeValue?: number;
  priorInventoryPurchaseId?: string;
  financialTransactionId?: string;
  financialTransactionItemId?: string;
  createdAt: string;
  updatedAt: string;
  ownershipShares?: OwnershipShare[];
}

export type TradeStatus = "draft" | "completed" | "cancelled" | "reversed";
export type TradeDirection = "outgoing" | "incoming" | "expense";
export type FinancialTransactionType = "sale" | "purchase" | "expense" | "trade" | "cash_trade";
export type TransactionItemMode = "single" | "multiple";
export type TransactionPricingMode = "individual" | "bundle_total";
export type TransactionImageType = "general" | "receipt" | "proof" | "item" | "front" | "back" | "crop";

export interface TransactionImageAttachment {
  id: string;
  transactionId: string;
  transactionItemId?: string;
  imageType: TransactionImageType;
  imageUrl: string;
  imagePath?: string;
  sortOrder: number;
  metadataStatus?: "pending" | "complete";
  metadataError?: string;
  reusedFromImageId?: string;
}

export interface TradeItemOwnershipShare extends OwnershipShare {
  allocatedCostBasis?: number;
  allocatedTradeValue?: number;
}

export interface TransactionPaymentEntry {
  id: string;
  direction: "received" | "paid";
  paymentMethod: SalePaymentMethod;
  amount: number;
  paidByWorkerId?: string;
  note?: string;
  paidAt: string;
}

export interface TradeItem {
  id: string;
  tradeTransactionId: string;
  inventoryPurchaseId?: string;
  createdInventoryPurchaseId?: string;
  priorInventoryPurchaseId?: string;
  direction: TradeDirection;
  itemName: string;
  itemType: PokemonProductCategory;
  quantity: number;
  marketValue: number;
  agreedTradeValue: number;
  historicalCostBasis: number;
  zeroCostBasisConfirmed?: boolean;
  costBasis: number;
  cashAllocation?: number;
  tradePercentage?: number;
  soldPrice?: number;
  boughtPrice?: number;
  createdSalesRecordId?: string;
  createdBusinessExpenseId?: string;
  imageUrl?: string;
  imagePath?: string;
  backImageUrl?: string;
  backImagePath?: string;
  images?: TransactionImageAttachment[];
  collectorNumber?: string;
  cardSet?: string;
  cardSetId?: string;
  cardSetCode?: string;
  cardRarity?: string;
  cardLanguage?: string;
  cardGame?: CardGame;
  dataProvider?: CardDataProvider;
  providerCardId?: string;
  cardCode?: string;
  marketPriceCurrency?: string;
  pokemonTcgCardId?: string;
  officialCardImageUrl?: string;
  tcgplayerUrl?: string;
  marketPriceSource?: string;
  marketPriceVariant?: string;
  marketPriceUpdatedAt?: string;
  marketPriceCheckedAt?: string;
  tcgplayerPricing?: import("../services/sales/cardScanService").TcgplayerPricing;
  targetBuyPercentage?: number;
  targetBuyPrice?: number;
  cardSelectionSource?: "manual" | "scanner" | "inventory";
  costBasisIsEstimate?: boolean;
  cardCondition?: CardCondition;
  stickerPrice?: number;
  stickerCondition?: CardCondition;
  gradingCompany?: string;
  grade?: string;
  certificateNumber?: string;
  ownershipShares: TradeItemOwnershipShare[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TradeTransaction {
  id: string;
  tradeDate: string;
  eventId?: string;
  eventDayId?: string;
  tradePartner?: string;
  transactionType: FinancialTransactionType;
  itemMode: TransactionItemMode;
  pricingMode: TransactionPricingMode;
  bundleTotal?: number;
  paymentMethod?: SalePaymentMethod;
  payments?: TransactionPaymentEntry[];
  purchaseSource?: PurchaseSource;
  expenseCategory?: BusinessExpenseCategory;
  paidByWorkerId?: string;
  keepAsBundle?: boolean;
  cashReceived: number;
  cashPaid: number;
  notes?: string;
  generalImageUrl?: string;
  generalImagePath?: string;
  proofImageUrl?: string;
  proofImagePath?: string;
  images?: TransactionImageAttachment[];
  status: TradeStatus;
  enteredByWorkerId?: string;
  completedAt?: string;
  reversedAt?: string;
  reversalOfTradeId?: string;
  createdAt: string;
  updatedAt: string;
  items: TradeItem[];
}

export interface InventoryTradeLineage {
  id: string;
  sourceInventoryPurchaseId: string;
  resultingInventoryPurchaseId: string;
  tradeTransactionId: string;
  relationshipType: "exchanged_for";
  createdAt: string;
}

export interface OwnershipShare {
  id?: string;
  workerId: string;
  ownershipPercentage: number;
  contributionAmount?: number;
}

export interface BusinessExpense {
  id: string;
  expenseDate: string;
  amount: number;
  category: BusinessExpenseCategory;
  description: string;
  eventId?: string;
  paidByWorkerId?: string;
  vendor?: string;
  receiptImageUrl?: string;
  receiptImagePath?: string;
  notes?: string;
  financialTransactionId?: string;
  financialTransactionItemId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuyItem {
  id: string;
  title: string;
  description?: string;
  productUrl?: string;
  imageUrl?: string;
  estimatedPrice?: number;
  quantity: number;
  priority: BuyItemPriority;
  purchased: boolean;
  purchasedBy?: string;
  purchasedByWorkerId?: string;
  purchasedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventDay {
  id: string;
  eventId: string;
  date: string;
  startTime?: string;
  endTime?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventDayWorker {
  id: string;
  eventId: string;
  eventDayId: string;
  workerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventPriceOption {
  id: string;
  eventId: string;
  label: string;
  price: number;
  pricingType: PricingType;
  appliesToDayIds?: string[];
  description?: string;
  isSelected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  eventId: string;
  workerId: string;
  amountPaid: number;
  paidAt?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventChecklistItem {
  id: string;
  eventId: string;
  label: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventFinance {
  id: string;
  eventId: string;
  totalSales: number;
  totalExpenses: number;
  gasCost: number;
  foodCost: number;
  miscCost: number;
  profitNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventLiveNote {
  id: string;
  eventId: string;
  workerId?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type SalesCategory = "Pokemon" | "One Piece" | "Slabs" | "Accessories" | "Sealed" | "Other";

export interface EventSalesCategory {
  id: string;
  eventId: string;
  category: SalesCategory;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventReview {
  id: string;
  eventId: string;
  overallRating: number;
  trafficRating: number;
  organizerRating: number;
  profitRating: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Worker {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: string;
  name: string;
  venueName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  instagramHandle?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: string;
  organizerId?: string;
  name: string;
  type: SourceType;
  url?: string;
  defaultVenueName?: string;
  defaultAddress?: string;
  defaultCity?: string;
  defaultState?: string;
  checkFrequencyLabel?: string;
  enabled: boolean;
  lastCheckedAt?: string;
  lastStatus?: string;
  lastError?: string;
  notes?: string;
  foundCount?: number;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedEventCandidate {
  id: string;
  sourceId?: string;
  organizerId?: string;
  sourceUrl?: string;
  rawText: string;
  rawTextSnippet: string;
  eventName?: string;
  startDate?: string;
  endDate?: string;
  timeText?: string;
  venueName?: string;
  address?: string;
  city?: string;
  state?: string;
  registrationUrl?: string;
  registrationStatus: RegistrationStatus;
  confidence: Confidence;
  detectionScore: number;
  classification: EventClassification;
  reasons: string[];
  warnings: string[];
  matchedKeywords: string[];
  missingFields: string[];
  reviewStatus: ReviewStatus;
  notifiedAt?: string;
  createdAt: string;
}

export interface AppSettings {
  id: "settings";
  homeAddress: string;
  homeLatitude?: number;
  homeLongitude?: number;
  distanceUnit: "miles";
  notificationsEnabled: boolean;
  reminderOffsets: number[];
  quietHoursStart: string;
  quietHoursEnd: string;
  showLowConfidenceResults: boolean;
  refreshOnAppOpen: boolean;
  sourceRefreshIntervalHours: number;
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventDecision {
  id: string;
  eventId: string;
  userName: string;
  decision: TeamDecision;
  notes?: string;
  reminderEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GeocodeCache {
  address: string;
  latitude: number;
  longitude: number;
  checkedAt: string;
}

export interface ScrapeLog {
  id: string;
  sourceId?: string;
  sourceUrl?: string;
  rawTextSnippet: string;
  score: number;
  classification: EventClassification;
  reasons: string[];
  warnings: string[];
  matchedKeywords: string[];
  missingFields: string[];
  createdAt: string;
}
