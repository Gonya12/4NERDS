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
export type InventoryStatus = "in_stock" | "partially_sold" | "sold" | "personal";
export type CardCondition = "Mint" | "Near Mint / NM" | "Lightly Played / LP" | "Moderately Played / MP" | "Heavily Played / HP" | "Damaged";
export type CardScanStatus = "not_scanned" | "analyzing" | "needs_review" | "ready_to_import" | "imported" | "failed";
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
  boughtFrom?: string;
  purchaseSource?: PurchaseSource;
  paymentMethod?: SalePaymentMethod;
  soldByWorkerId?: string;
  isRawCard: boolean;
  buyPercentage?: number;
  targetBuyPrice?: number;
  inventoryPurchaseId?: string;
  notes?: string;
  soldAt: string;
  pendingUpload: boolean;
  createdAt: string;
  updatedAt: string;
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
  marketValue?: number;
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
  cardLanguage?: string;
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
  createdAt: string;
  updatedAt: string;
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
