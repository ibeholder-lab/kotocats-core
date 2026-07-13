'use strict';

const express = require('express');
const axios = require('axios');

function createSubscriptionsRouter(options = {}) {
  const router = express.Router();

  const directusUrl = String(
    options.directusUrl ||
    process.env.DIRECTUS_URL ||
    ''
  ).replace(/\/+$/, '');

  const directusToken = String(
    options.directusToken ||
    process.env.DIRECTUS_TOKEN ||
    ''
  ).trim();

  const internalToken = String(
    options.internalToken ||
    process.env.KOTOCATS_CORE_INTERNAL_TOKEN ||
    ''
  ).trim();

  if (!directusUrl) {
    throw new Error(
      'subscriptions: DIRECTUS_URL is required'
    );
  }

  if (!directusToken) {
    throw new Error(
      'subscriptions: DIRECTUS_TOKEN is required'
    );
  }

  function apiHeaders(extra = {}) {
    return {
      Authorization: `Bearer ${directusToken}`,
      ...extra,
    };
  }

  function requireInternalToken(req, res, next) {
    if (!internalToken) {
      return res.status(503).json({
        ok: false,
        error: 'internal_token_not_configured',
      });
    }

    const received = String(
      req.headers['x-kotocats-core-token'] || ''
    ).trim();

    if (received !== internalToken) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
      });
    }

    return next();
  }

  function normalizeId(value) {
    return String(value || '').trim();
  }

  function normalizeTelegramId(value) {
    const id = String(value || '').trim();

    if (!/^-?\d+$/.test(id)) {
      return null;
    }

    return id;
  }

  async function directusGet(params = {}) {
    const response = await axios.get(
      `${directusUrl}/items/animal_subscriptions`,
      {
        headers: apiHeaders(),
        params,
        timeout: 30000,
      }
    );

    return response.data?.data || [];
  }

  async function directusPost(data) {
    const response = await axios.post(
      `${directusUrl}/items/animal_subscriptions`,
      data,
      {
        headers: apiHeaders({
          'Content-Type': 'application/json',
        }),
        timeout: 30000,
      }
    );

    return response.data?.data || null;
  }

  async function directusPatch(id, data) {
    const response = await axios.patch(
      `${directusUrl}/items/animal_subscriptions/${encodeURIComponent(id)}`,
      data,
      {
        headers: apiHeaders({
          'Content-Type': 'application/json',
        }),
        timeout: 30000,
      }
    );

    return response.data?.data || null;
  }

  async function findSubscription(
    animalId,
    telegramUserId
  ) {
    const rows = await directusGet({
      filter: {
        animal_id: {
          _eq: animalId,
        },
        channel: {
          _eq: 'telegram',
        },
        telegram_user_id: {
          _eq: telegramUserId,
        },
      },
      fields: [
        'id',
        'animal_id',
        'channel',
        'telegram_user_id',
        'telegram_chat_id',
        'is_active',
        'created_at',
        'updated_at',
      ].join(','),
      limit: 1,
    });

    return rows[0] || null;
  }

  router.use(requireInternalToken);

  /*
   * Проверить состояние подписки.
   *
   * GET /api/subscriptions/animals/:animalId/status
   *     ?telegram_user_id=123
   */
  router.get(
    '/animals/:animalId/status',
    async (req, res) => {
      try {
        const animalId = normalizeId(
          req.params.animalId
        );

        const telegramUserId =
          normalizeTelegramId(
            req.query.telegram_user_id
          );

        if (!animalId || !telegramUserId) {
          return res.status(400).json({
            ok: false,
            error: 'invalid_parameters',
          });
        }

        const subscription =
          await findSubscription(
            animalId,
            telegramUserId
          );

        return res.json({
          ok: true,
          data: {
            subscribed:
              subscription?.is_active === true,
            subscription:
              subscription || null,
          },
        });
      } catch (error) {
        console.error(
          'SUBSCRIPTION STATUS ERROR:',
          error.response?.data || error.message
        );

        return res.status(500).json({
          ok: false,
          error: 'subscription_status_failed',
          message: error.message,
        });
      }
    }
  );

  /*
   * Подписаться.
   *
   * POST /api/subscriptions/animals/:animalId
   *
   * {
   *   "telegram_user_id": "123",
   *   "telegram_chat_id": "123"
   * }
   */
  router.post(
    '/animals/:animalId',
    async (req, res) => {
      try {
        const animalId = normalizeId(
          req.params.animalId
        );

        const telegramUserId =
          normalizeTelegramId(
            req.body?.telegram_user_id
          );

        const telegramChatId =
          normalizeTelegramId(
            req.body?.telegram_chat_id
          );

        if (
          !animalId ||
          !telegramUserId ||
          !telegramChatId
        ) {
          return res.status(400).json({
            ok: false,
            error: 'invalid_parameters',
          });
        }

        const existing =
          await findSubscription(
            animalId,
            telegramUserId
          );

        let subscription;

        if (existing) {
          subscription = await directusPatch(
            existing.id,
            {
              telegram_chat_id:
                telegramChatId,
              is_active: true,
              updated_at:
                new Date().toISOString(),
            }
          );
        } else {
          subscription = await directusPost({
            animal_id: animalId,
            channel: 'telegram',
            telegram_user_id:
              telegramUserId,
            telegram_chat_id:
              telegramChatId,
            is_active: true,
            created_at:
              new Date().toISOString(),
            updated_at:
              new Date().toISOString(),
          });
        }

        return res.json({
          ok: true,
          data: {
            subscribed: true,
            subscription,
          },
        });
      } catch (error) {
        console.error(
          'SUBSCRIBE ANIMAL ERROR:',
          error.response?.data || error.message
        );

        return res.status(500).json({
          ok: false,
          error: 'subscribe_animal_failed',
          message: error.message,
        });
      }
    }
  );

  /*
   * Отписаться.
   *
   * DELETE /api/subscriptions/animals/:animalId
   *
   * {
   *   "telegram_user_id": "123"
   * }
   */
  router.delete(
    '/animals/:animalId',
    async (req, res) => {
      try {
        const animalId = normalizeId(
          req.params.animalId
        );

        const telegramUserId =
          normalizeTelegramId(
            req.body?.telegram_user_id ||
            req.query?.telegram_user_id
          );

        if (!animalId || !telegramUserId) {
          return res.status(400).json({
            ok: false,
            error: 'invalid_parameters',
          });
        }

        const existing =
          await findSubscription(
            animalId,
            telegramUserId
          );

        if (!existing) {
          return res.json({
            ok: true,
            data: {
              subscribed: false,
              subscription: null,
            },
          });
        }

        const subscription =
          await directusPatch(
            existing.id,
            {
              is_active: false,
              updated_at:
                new Date().toISOString(),
            }
          );

        return res.json({
          ok: true,
          data: {
            subscribed: false,
            subscription,
          },
        });
      } catch (error) {
        console.error(
          'UNSUBSCRIBE ANIMAL ERROR:',
          error.response?.data || error.message
        );

        return res.status(500).json({
          ok: false,
          error: 'unsubscribe_animal_failed',
          message: error.message,
        });
      }
    }
  );

  return router;
}

module.exports = {
  createSubscriptionsRouter,
};
