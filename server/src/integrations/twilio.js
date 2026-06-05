/**
 * Интеграция с Twilio для автоматических звонков и SMS
 */

const crypto = require('crypto');
const https = require('https');
const { ExternalFetchTimeoutError, timeoutFromEnv } = require('../http');

class TwilioClient {
  constructor(accountSid, authToken, fromPhone, options = {}) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromPhone = fromPhone;
    this.baseUrl = 'api.twilio.com';
    this.enabled = Boolean(accountSid && authToken && fromPhone);
    this.timeoutMs = options.timeoutMs ?? timeoutFromEnv('TWILIO_REQUEST_TIMEOUT_MS', 10000);
  }

  /**
   * Базовый HTTP-запрос к Twilio API
   */
  async request(method, path, data = null) {
    if (!this.enabled) {
      throw new Error('Twilio не настроен. Проверьте TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER в .env');
    }

    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    const body = data ? new URLSearchParams(data).toString() : '';

    const options = {
      hostname: this.baseUrl,
      port: 443,
      path: `/2010-04-01/Accounts/${this.accountSid}${path}`,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseData);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(new Error(parsed.message || `Twilio API error: ${res.statusCode}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse Twilio response: ${responseData}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new ExternalFetchTimeoutError(this.timeoutMs));
      });
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  /**
   * Отправить голосовое сообщение (TwiML)
   */
  async makeCall(toPhone, voiceMessage, statusCallbackUrl = null) {
    if (!this.enabled) {
      throw new Error('Twilio не настроен');
    }

    // Нормализуем номер телефона
    const normalizedTo = this.normalizePhone(toPhone);

    // Создаём TwiML для голосового сообщения
    const twimlUrl = this.createTwiMLUrl(voiceMessage);

    const data = {
      To: normalizedTo,
      From: this.fromPhone,
      Url: twimlUrl,
      Method: 'GET',
    };

    if (statusCallbackUrl) {
      data.StatusCallback = statusCallbackUrl;
      data.StatusCallbackMethod = 'POST';
      data.StatusCallbackEvent = ['initiated', 'ringing', 'answered', 'completed'];
    }

    const response = await this.request('POST', '/Calls.json', data);
    return {
      callSid: response.sid,
      status: response.status,
      to: response.to,
      from: response.from,
      direction: response.direction,
      dateCreated: response.date_created,
    };
  }

  /**
   * Отправить SMS
   */
  async sendSMS(toPhone, message, statusCallbackUrl = null) {
    if (!this.enabled) {
      throw new Error('Twilio не настроен');
    }

    const normalizedTo = this.normalizePhone(toPhone);

    const data = {
      To: normalizedTo,
      From: this.fromPhone,
      Body: message,
    };

    if (statusCallbackUrl) {
      data.StatusCallback = statusCallbackUrl;
    }

    const response = await this.request('POST', '/Messages.json', data);
    return {
      messageSid: response.sid,
      status: response.status,
      to: response.to,
      from: response.from,
      body: response.body,
      dateCreated: response.date_created,
    };
  }

  /**
   * Получить статус звонка
   */
  async getCallStatus(callSid) {
    if (!this.enabled) {
      throw new Error('Twilio не настроен');
    }

    const response = await this.request('GET', `/Calls/${callSid}.json`);
    return {
      callSid: response.sid,
      status: response.status,
      duration: response.duration,
      answeredBy: response.answered_by,
      startTime: response.start_time,
      endTime: response.end_time,
    };
  }

  /**
   * Получить статус SMS
   */
  async getSMSStatus(messageSid) {
    if (!this.enabled) {
      throw new Error('Twilio не настроен');
    }

    const response = await this.request('GET', `/Messages/${messageSid}.json`);
    return {
      messageSid: response.sid,
      status: response.status,
      to: response.to,
      from: response.from,
      body: response.body,
      dateSent: response.date_sent,
      errorCode: response.error_code,
      errorMessage: response.error_message,
    };
  }

  /**
   * Нормализация телефонного номера для Twilio (E.164 формат)
   */
  normalizePhone(phone) {
    // Убираем все нецифровые символы
    let cleaned = phone.replace(/\D/g, '');

    // Если номер начинается с 8, заменяем на 7 (Россия)
    if (cleaned.startsWith('8') && cleaned.length === 11) {
      cleaned = '7' + cleaned.slice(1);
    }

    // Если номер не начинается с +, добавляем +
    if (!phone.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    return cleaned;
  }

  /**
   * Создать TwiML URL для голосового сообщения
   * В production это должен быть реальный endpoint вашего сервера
   */
  createTwiMLUrl(message) {
    // Для простоты используем Twilio TwiML Bins или внешний сервис
    // В production нужно создать endpoint на вашем сервере, который вернёт TwiML
    const encodedMessage = encodeURIComponent(message);
    return `http://twimlets.com/message?Message=${encodedMessage}`;
  }

  /**
   * Проверка настроек Twilio
   */
  getStatus() {
    return {
      enabled: this.enabled,
      accountSid: this.accountSid ? `${this.accountSid.slice(0, 8)}...` : null,
      fromPhone: this.fromPhone || null,
      hasAuthToken: Boolean(this.authToken),
    };
  }
}

/**
 * Создать клиент Twilio из переменных окружения
 */
function createTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;

  return new TwilioClient(accountSid, authToken, fromPhone);
}

function timingSafeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''));
  const rightBuffer = Buffer.from(String(right ?? ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function twilioSignature(url, params, authToken) {
  const payload = Object.keys(params ?? {})
    .sort()
    .reduce((acc, key) => `${acc}${key}${params[key]}`, url);
  return crypto.createHmac('sha1', authToken).update(payload).digest('base64');
}

function validateTwilioRequest({ url, params, signature, authToken }) {
  if (!authToken || !signature || !url) return false;
  const expected = twilioSignature(url, params, authToken);
  return timingSafeTextEqual(signature, expected);
}

module.exports = {
  TwilioClient,
  createTwilioClient,
  validateTwilioRequest,
  twilioSignature,
};
