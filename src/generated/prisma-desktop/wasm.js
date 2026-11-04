
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 6.2.0
 * Query Engine version: 4123509d24aa4dede1e864b46351bf2790323b69
 */
Prisma.prismaVersion = {
  client: "6.2.0",
  engine: "4123509d24aa4dede1e864b46351bf2790323b69"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  Serializable: 'Serializable'
});

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  name: 'name',
  email: 'email',
  password: 'password',
  role: 'role',
  apiKey: 'apiKey',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SessionScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  name: 'name',
  sessionId: 'sessionId',
  status: 'status',
  qr: 'qr',
  config: 'config',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ContactScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  jid: 'jid',
  lid: 'lid',
  name: 'name',
  notify: 'notify',
  verifiedName: 'verifiedName',
  remoteJidAlt: 'remoteJidAlt',
  profilePic: 'profilePic',
  data: 'data',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.MessageScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  remoteJid: 'remoteJid',
  senderJid: 'senderJid',
  fromMe: 'fromMe',
  keyId: 'keyId',
  pushName: 'pushName',
  type: 'type',
  content: 'content',
  mediaUrl: 'mediaUrl',
  status: 'status',
  timestamp: 'timestamp',
  quoteId: 'quoteId',
  contactId: 'contactId'
};

exports.Prisma.GroupScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  jid: 'jid',
  subject: 'subject',
  description: 'description',
  ownerJid: 'ownerJid',
  participants: 'participants',
  creation: 'creation',
  restrict: 'restrict',
  announce: 'announce',
  metadata: 'metadata',
  inviteCode: 'inviteCode',
  isCommunity: 'isCommunity',
  linkedParentJid: 'linkedParentJid',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AutoReplyScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  keyword: 'keyword',
  matchType: 'matchType',
  response: 'response',
  isMedia: 'isMedia',
  mediaUrl: 'mediaUrl',
  mediaType: 'mediaType',
  triggerType: 'triggerType',
  createdAt: 'createdAt'
};

exports.Prisma.StoryScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  jid: 'jid',
  content: 'content',
  mediaUrl: 'mediaUrl',
  type: 'type',
  timestamp: 'timestamp',
  viewed: 'viewed'
};

exports.Prisma.ScheduledMessageScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  jid: 'jid',
  content: 'content',
  mediaUrl: 'mediaUrl',
  mediaType: 'mediaType',
  sendAt: 'sendAt',
  cronExpression: 'cronExpression',
  recurrenceRule: 'recurrenceRule',
  status: 'status',
  createdAt: 'createdAt'
};

exports.Prisma.AuthStateScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  key: 'key',
  value: 'value'
};

exports.Prisma.WebhookScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  sessionId: 'sessionId',
  name: 'name',
  url: 'url',
  secret: 'secret',
  events: 'events',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WebhookLogScalarFieldEnum = {
  id: 'id',
  webhookId: 'webhookId',
  event: 'event',
  status: 'status',
  requestUrl: 'requestUrl',
  requestHeaders: 'requestHeaders',
  requestBody: 'requestBody',
  responseStatusCode: 'responseStatusCode',
  responseBody: 'responseBody',
  responseTimeMs: 'responseTimeMs',
  errorMessage: 'errorMessage',
  createdAt: 'createdAt'
};

exports.Prisma.BotConfigScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  enabled: 'enabled',
  botName: 'botName',
  botMode: 'botMode',
  botAllowedJids: 'botAllowedJids',
  botBlockedJids: 'botBlockedJids',
  autoReplyMode: 'autoReplyMode',
  autoReplyAllowedJids: 'autoReplyAllowedJids',
  autoReplyBlockedJids: 'autoReplyBlockedJids',
  enableSticker: 'enableSticker',
  enableVideoSticker: 'enableVideoSticker',
  maxStickerDuration: 'maxStickerDuration',
  enablePing: 'enablePing',
  enableUptime: 'enableUptime',
  removeBgApiKey: 'removeBgApiKey',
  prefix: 'prefix',
  antiSpamEnabled: 'antiSpamEnabled',
  spamLimit: 'spamLimit',
  spamInterval: 'spamInterval',
  spamDelayMin: 'spamDelayMin',
  spamDelayMax: 'spamDelayMax',
  welcomeMessage: 'welcomeMessage',
  autoRead: 'autoRead',
  alwaysOnline: 'alwaysOnline',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SystemConfigScalarFieldEnum = {
  id: 'id',
  appName: 'appName',
  logoUrl: 'logoUrl',
  faviconUrl: 'faviconUrl',
  timezone: 'timezone',
  enableRegistration: 'enableRegistration',
  updatedAt: 'updatedAt'
};

exports.Prisma.LabelScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  name: 'name',
  color: 'color',
  colorHex: 'colorHex',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ChatLabelScalarFieldEnum = {
  id: 'id',
  labelId: 'labelId',
  chatJid: 'chatJid',
  createdAt: 'createdAt'
};

exports.Prisma.NotificationScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  title: 'title',
  message: 'message',
  type: 'type',
  read: 'read',
  href: 'href',
  createdAt: 'createdAt'
};

exports.Prisma.SessionAccessScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  userId: 'userId',
  createdAt: 'createdAt'
};

exports.Prisma.BroadcastLogScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  message: 'message',
  total: 'total',
  sent: 'sent',
  failed: 'failed',
  status: 'status',
  delay: 'delay',
  startedAt: 'startedAt',
  completedAt: 'completedAt'
};

exports.Prisma.BroadcastRecipientScalarFieldEnum = {
  id: 'id',
  broadcastLogId: 'broadcastLogId',
  jid: 'jid',
  status: 'status',
  error: 'error',
  sentAt: 'sentAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull
};

exports.Prisma.JsonNullValueInput = {
  JsonNull: Prisma.JsonNull
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};

exports.Prisma.JsonNullValueFilter = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull,
  AnyNull: Prisma.AnyNull
};


exports.Prisma.ModelName = {
  User: 'User',
  Session: 'Session',
  Contact: 'Contact',
  Message: 'Message',
  Group: 'Group',
  AutoReply: 'AutoReply',
  Story: 'Story',
  ScheduledMessage: 'ScheduledMessage',
  AuthState: 'AuthState',
  Webhook: 'Webhook',
  WebhookLog: 'WebhookLog',
  BotConfig: 'BotConfig',
  SystemConfig: 'SystemConfig',
  Label: 'Label',
  ChatLabel: 'ChatLabel',
  Notification: 'Notification',
  SessionAccess: 'SessionAccess',
  BroadcastLog: 'BroadcastLog',
  BroadcastRecipient: 'BroadcastRecipient'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
