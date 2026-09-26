const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

app.use(express.json());
app.use(cors());

/* =========================================================
   FIREBASE ADMIN
   ========================================================= */

const serviceAccountString =
  process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountString) {

  console.error(
    'FIREBASE_SERVICE_ACCOUNT is missing!'
  );

} else {

  try {

    const serviceAccount =
      JSON.parse(serviceAccountString);

    admin.initializeApp({

      credential:
        admin.credential.cert(
          serviceAccount
        ),

      databaseURL:
        'https://hrrybimd-default-rtdb.firebaseio.com/'

    });

  } catch (e) {

    console.error(
      'Error parsing FIREBASE_SERVICE_ACCOUNT:',
      e
    );

  }

}

const db = admin.database();


/* =========================================================
   TELEGRAM
   ========================================================= */

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const CHANNEL_USERNAME =
  '@hrbseb10thallcorse';

const CHANNEL_URL =
  'https://t.me/hrbseb10thallcorse';


/* =========================================================
   PHOTO URL
   ========================================================= */

function withPhotoUrl(
  data,
  sessionToken
) {

  if (!data) return data;

  return {

    ...data,

    photoUrl:
      data.photoFileId &&
      sessionToken

        ? `${
            process.env.PUBLIC_BASE_URL ||
            'https://telegram-bind-backend4.onrender.com'
          }/api/profile/photo/${
            encodeURIComponent(
              data.telegramId
            )
          }?session=${
            encodeURIComponent(
              sessionToken
            )
          }`

        : ''

  };

}


if (!BOT_TOKEN) {

  console.error(
    'TELEGRAM_BOT_TOKEN is missing!'
  );

}


/* =========================================================
   SHA256
   ========================================================= */

function sha256(value) {

  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex');

}


/* =========================================================
   TELEGRAM API
   ========================================================= */

async function telegramApi(
  method,
  params = {}
) {

  const url =
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

  const response =
    await axios.get(
      url,
      {
        params,
        timeout: 15000
      }
    );

  if (
    !response.data ||
    !response.data.ok
  ) {

    throw new Error(
      response.data?.description ||
      `Telegram API ${method} failed`
    );

  }

  return response.data.result;

}


/* =========================================================
   SUBSCRIPTION STATUS
   ========================================================= */

function isSubscribed(member) {

  if (!member) return false;

  if (
    [
      'creator',
      'administrator',
      'member'
    ].includes(member.status)
  ) {

    return true;

  }

  if (
    member.status === 'restricted' &&
    member.is_member === true
  ) {

    return true;

  }

  return false;

}


/* =========================================================
   EXISTING SUBSCRIPTION CHECK
   ========================================================= */

async function checkChannelSubscription(
  telegramId
) {

  try {

    const member =
      await telegramApi(
        'getChatMember',
        {
          chat_id:
            CHANNEL_USERNAME,

          user_id:
            telegramId
        }
      );

    return isSubscribed(member);

  } catch (error) {

    console.error(
      'Subscription check error:',
      error.response?.data ||
      error.message
    );

    return false;

  }

}


/* =========================================================
   TELEGRAM PROFILE PHOTO
   ========================================================= */

async function getProfilePhotoFileId(
  userId
) {

  try {

    const photos =
      await telegramApi(
        'getUserProfilePhotos',
        {
          user_id: userId,
          limit: 1
        }
      );

    if (
      !photos ||
      !photos.total_count ||
      !photos.photos?.[0]?.length
    ) {

      return '';

    }

    const best =
      photos.photos[0][
        photos.photos[0].length - 1
      ];

    return best.file_id || '';

  } catch (error) {

    console.error(
      'Profile photo error:',
      error.message
    );

    return '';

  }

}


/* =========================================================
   CREATE SESSION
   ========================================================= */

async function makeSession(
  telegramData
) {

  const sessionToken =
    crypto
      .randomBytes(32)
      .toString('hex');

  const sessionHash =
    sha256(sessionToken);

  await db
    .ref(
      `telegram_sessions/${sessionHash}`
    )
    .set({

      telegramId:
        telegramData.telegramId,

      createdAt:
        Date.now()

    });

  return sessionToken;

}


/* =========================================================
   GET BINDING BY SESSION
   ========================================================= */

async function getBindingBySession(
  sessionToken
) {

  if (!sessionToken) return null;

  const hash =
    sha256(sessionToken);

  const snap =
    await db
      .ref(
        `telegram_sessions/${hash}`
      )
      .once('value');

  if (!snap.exists()) {

    return null;

  }

  const data =
    snap.val();

  const bindingSnap =
    await db
      .ref(
        `telegram_bindings/${data.telegramId}`
      )
      .once('value');

  if (!bindingSnap.exists()) {

    return null;

  }

  return {

    sessionHash:
      hash,

    session:
      data,

    binding:
      bindingSnap.val()

  };

}


/* =========================================================
   HEALTH
   ========================================================= */

app.get(
  '/health',
  (req, res) => {

    res.json({

      status:
        'ok',

      channel:
        CHANNEL_URL

    });

  }
);


/* =========================================================
   START BINDING
   ========================================================= */

app.post(
  '/api/bind/start',
  async (req, res) => {

    try {

      const token =
        crypto
          .randomBytes(6)
          .toString('hex')
          .toUpperCase();

      const expiresAt =
        Date.now() +
        5 * 60 * 1000;

      const deviceId =
        req.body?.deviceId || '';

      const appName =
        req.body?.appName ||
        'hrry.test';

      await db
        .ref(
          `binding_tokens/${token}`
        )
        .set({

          status:
            'pending',

          createdAt:
            Date.now(),

          expiresAt,

          deviceId,

          appName

        });

      res.json({

        success:
          true,

        token,

        telegramUrl:
          `https://t.me/studymodshrry_bot?start=${token}`,

        channelUrl:
          CHANNEL_URL

      });

    } catch (error) {

      console.error(error);

      res.status(500).json({

        success:
          false,

        error:
          'Internal Server Error'

      });

    }

  }
);


/* =========================================================
   BIND STATUS
   ========================================================= */

app.post(
  '/api/bind/status',
  async (req, res) => {

    const {
      token
    } = req.body || {};

    if (!token) {

      return res.status(400).json({

        success:
          false,

        error:
          'Token missing'

      });

    }

    try {

      const snapshot =
        await db
          .ref(
            `binding_tokens/${token}`
          )
          .once('value');

      if (!snapshot.exists()) {

        return res.json({

          success:
            false,

          status:
            'not_found'

        });

      }

      const data =
        snapshot.val();

      if (
        Date.now() >
        data.expiresAt &&
        data.status !==
          'completed'
      ) {

        await db
          .ref(
            `binding_tokens/${token}`
          )
          .remove();

        return res.json({

          success:
            false,

          status:
            'expired'

        });

      }

      if (
        data.status === 'bound' ||
        data.status === 'completed'
      ) {

        const subscribed =
          await checkChannelSubscription(
            data.telegramData.telegramId
          );

        if (
          data.status === 'completed' &&
          data.sessionToken
        ) {

          return res.json({

            success:
              true,

            status:
              'completed',

            subscribed,

            telegramData:
              withPhotoUrl(
                data.telegramData,
                data.sessionToken
              ),

            sessionToken:
              data.sessionToken

          });

        }

        return res.json({

          success:
            true,

          status:
            'bound',

          subscribed,

          telegramData:
            data.telegramData

        });

      }

      return res.json({

        success:
          true,

        status:
          'pending'

      });

    } catch (error) {

      console.error(error);

      res.status(500).json({

        success:
          false,

        error:
          'Server Error'

      });

    }

  }
);


/* =========================================================
   BIND CHECK
   ========================================================= */

app.post(
  '/api/bind/check',
  async (req, res) => {

    const {
      token
    } = req.body || {};

    if (!token) {

      return res.status(400).json({

        success:
          false,

        error:
          'Token missing'

      });

    }

    try {

      const ref =
        db.ref(
          `binding_tokens/${token}`
        );

      const snapshot =
        await ref.once('value');

      if (!snapshot.exists()) {

        return res.json({

          success:
            false,

          error:
            'Binding token not found'

        });

      }

      const data =
        snapshot.val();

      if (
        !data.telegramData?.telegramId
      ) {

        return res.json({

          success:
            false,

          error:
            'Telegram account not bound yet'

        });

      }

      const subscribed =
        await checkChannelSubscription(
          data.telegramData.telegramId
        );

      if (!subscribed) {

        return res.json({

          success:
            true,

          subscribed:
            false,

          telegramData:
            data.telegramData

        });

      }

      let sessionToken =
        data.sessionToken;

      if (!sessionToken) {

        sessionToken =
          await makeSession(
            data.telegramData
          );

      }

      const updatedBinding = {

        ...data.telegramData,

        deviceId:
          data.deviceId ||
          '',

        appName:
          data.appName ||
          'hrry.test',

        subscribed:
          true,

        subscriptionVerifiedAt:
          Date.now(),

        sessionCreatedAt:
          Date.now()

      };

      await db
        .ref(
          `telegram_bindings/${data.telegramData.telegramId}`
        )
        .set(
          updatedBinding
        );

      await ref.update({

        status:
          'completed',

        sessionToken,

        telegramData:
          updatedBinding,

        completedAt:
          Date.now()

      });

      res.json({

        success:
          true,

        subscribed:
          true,

        telegramData:
          withPhotoUrl(
            updatedBinding,
            sessionToken
          ),

        sessionToken

      });

    } catch (error) {

      console.error(error);

      res.status(500).json({

        success:
          false,

        error:
          'Subscription verification failed'

      });

    }

  }
);


/* =========================================================
   EXISTING SESSION CHECK
   ========================================================= */

app.post(
  '/api/bind/session',
  async (req, res) => {

    const {
      sessionToken
    } = req.body || {};

    if (!sessionToken) {

      return res.status(400).json({

        success:
          false,

        error:
          'Session missing'

      });

    }

    try {

      const found =
        await getBindingBySession(
          sessionToken
        );

      if (!found) {

        return res.json({

          success:
            false,

          error:
            'Session invalid'

        });

      }

      const subscribed =
        await checkChannelSubscription(
          found.binding.telegramId
        );

      if (!subscribed) {

        return res.json({

          success:
            false,

          subscribed:
            false,

          telegramData:
            found.binding

        });

      }

      await db
        .ref(
          `telegram_bindings/${found.binding.telegramId}`
        )
        .update({

          subscribed:
            true,

          subscriptionVerifiedAt:
            Date.now()

        });

      res.json({

        success:
          true,

        subscribed:
          true,

        telegramData:
          withPhotoUrl(
            {
              ...found.binding,
              subscribed:
                true
            },
            sessionToken
          )

      });

    } catch (error) {

      console.error(error);

      res.status(500).json({

        success:
          false,

        error:
          'Session verification failed'

      });

    }

  }
);


/* =========================================================
   UNBIND
   ========================================================= */

app.post(
  '/api/bind/unbind',
  async (req, res) => {

    const {
      telegramId
    } = req.body || {};

    if (!telegramId) {

      return res.status(400).json({

        success:
          false

      });

    }

    const sessionSnap =
      await db
        .ref(
          'telegram_sessions'
        )
        .once('value');

    const sessions =
      sessionSnap.val() || {};

    const updates = {};

    for (
      const [
        hash,
        value
      ]
      of Object.entries(sessions)
    ) {

      if (
        String(
          value.telegramId
        ) ===
        String(
          telegramId
        )
      ) {

        updates[
          `telegram_sessions/${hash}`
        ] = null;

      }

    }

    updates[
      `telegram_bindings/${telegramId}`
    ] = null;

    await db
      .ref()
      .update(
        updates
      );

    res.json({

      success:
        true

    });

  }
);


/* =========================================================
   PROFILE PHOTO PROXY
   ========================================================= */

app.get(
  '/api/profile/photo/:telegramId',
  async (req, res) => {

    try {

      const session =
        req.query.session;

      const found =
        await getBindingBySession(
          session
        );

      if (
        !found ||
        String(
          found.binding.telegramId
        ) !==
        String(
          req.params.telegramId
        )
      ) {

        return res
          .status(403)
          .end();

      }

      const fileId =
        found.binding.photoFileId;

      if (!fileId) {

        return res
          .status(404)
          .end();

      }

      const file =
        await telegramApi(
          'getFile',
          {
            file_id:
              fileId
          }
        );

      const image =
        await axios.get(

          `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`,

          {
            responseType:
              'stream',

            timeout:
              15000

          }

        );

      res.setHeader(

        'Content-Type',

        image.headers[
          'content-type'
        ] ||
        'image/jpeg'

      );

      image.data.pipe(
        res
      );

    } catch (error) {

      console.error(

        'Photo proxy error:',
        error.message

      );

      res
        .status(404)
        .end();

    }

  }
);


/* =========================================================
   TELEGRAM WEBHOOK
   ========================================================= */

app.post(
  '/telegram/webhook',
  async (req, res) => {

    const update =
      req.body;

    try {

      if (
        update.message?.text
          ?.startsWith('/start ')
      ) {

        const token =
          update.message.text
            .split(' ')[1];

        const user =
          update.message.from;

        const tokenRef =
          db.ref(
            `binding_tokens/${token}`
          );

        const snapshot =
          await tokenRef
            .once('value');

        if (
          snapshot.exists() &&
          snapshot.val().status ===
            'pending' &&
          snapshot.val().expiresAt >
            Date.now()
        ) {

          const photoFileId =
            await getProfilePhotoFileId(
              user.id
            );

          const telegramData = {

            telegramId:
              user.id,

            firstName:
              user.first_name ||
              '',

            lastName:
              user.last_name ||
              '',

            username:
              user.username ||
              'No Username',

            photoFileId,

            connectedAt:
              Date.now()

          };

          await tokenRef.update({

            status:
              'bound',

            telegramData

          });

          await db
            .ref(
              `telegram_bindings/${user.id}`
            )
            .set({

              ...telegramData,

              deviceId:
                snapshot.val()
                  .deviceId ||
                '',

              appName:
                snapshot.val()
                  .appName ||
                'hrry.test',

              subscribed:
                false

            });

          await axios.post(

            `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,

            {

              chat_id:
                user.id,

              text:
                `✅ Telegram account bind हो गया है, ${user.first_name || 'User'}!\n\nअब ${CHANNEL_URL} पर channel Join करें और app में Check Subscription दबाएँ।`

            }

          );

        } else {

          await axios.post(

            `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,

            {

              chat_id:
                user.id,

              text:
                '❌ Invalid or expired binding code. Please generate a new code from the app.'

            }

          );

        }

      }

    } catch (error) {

      console.error(

        'Webhook error:',
        error.response?.data ||
        error.message

      );

    }

    res.sendStatus(
      200
    );

  }
);


/* =========================================================
   NEW HRRY SUBSCRIPTION CHECK
   ONLY FOR com.test.hrry
   =========================================================

   पुराने apps की checkChannelSubscription()
   को बिल्कुल touch नहीं किया गया है.
   ========================================================= */

async function checkHrryChannelSubscription(
  telegramId
) {

  try {

    /*
     * Channel username से actual Telegram
     * chat information निकालना
     */

    const chat =
      await telegramApi(
        'getChat',
        {
          chat_id:
            CHANNEL_USERNAME
        }
      );


    /*
     * Numeric channel ID से member check
     */

    const member =
      await telegramApi(
        'getChatMember',
        {

          chat_id:
            chat.id,

          user_id:
            telegramId

        }
      );


    return {

      subscribed:
        isSubscribed(
          member
        ),

      telegramStatus:
        member?.status ||
        'unknown',

      chatId:
        String(
          chat.id
        )

    };

  } catch (error) {

    console.error(

      'Hrry subscription check error:',

      error.response?.data ||
      error.message

    );

    return {

      subscribed:
        false,

      telegramStatus:
        'check_error',

      error:
        error.response?.data?.description ||
        error.message ||
        'Telegram API error'

    };

  }

}


/* =========================================================
   HRRY NATIVE APP ACCESS
   PACKAGE:
   com.test.hrry

   NEW ROUTE ONLY:

   POST /api/hrry/access

   पुराने routes को replace नहीं करता.
   ========================================================= */

app.post(
  '/api/hrry/access',
  async (req, res) => {

    const {
      telegramId
    } = req.body || {};


    /* -----------------------------------------------------
       TELEGRAM ID CHECK
       ----------------------------------------------------- */

    if (!telegramId) {

      return res
        .status(400)
        .json({

          success:
            false,

          error:
            'Telegram ID missing'

        });

    }


    try {

      /* ---------------------------------------------------
         FIREBASE BINDING
         --------------------------------------------------- */

      const bindingSnap =
        await db
          .ref(
            `telegram_bindings/${telegramId}`
          )
          .once('value');


      /* ---------------------------------------------------
         NOT BOUND
         --------------------------------------------------- */

      if (!bindingSnap.exists()) {

        return res.json({

          success:
            false,

          bound:
            false,

          subscribed:
            false,

          blocked:
            false,

          error:
            'Telegram account is not bound'

        });

      }


      const binding =
        bindingSnap.val() ||
        {};


      /* ---------------------------------------------------
         BLOCK CHECK
         --------------------------------------------------- */

      const blocked =
        binding.isBlocked === true ||
        binding.blocked === true;


      if (blocked) {

        return res.json({

          success:
            true,

          bound:
            true,

          subscribed:
            false,

          blocked:
            true,

          telegramData:
            binding

        });

      }


      /* ---------------------------------------------------
         HRRY-SPECIFIC TELEGRAM SUBSCRIPTION CHECK
         --------------------------------------------------- */

      const verification =
        await checkHrryChannelSubscription(
          telegramId
        );


      /* ---------------------------------------------------
         NOT SUBSCRIBED
         --------------------------------------------------- */

      if (!verification.subscribed) {

        return res.json({

          success:
            true,

          bound:
            true,

          subscribed:
            false,

          blocked:
            false,

          telegramData:
            binding,

          verification: {

            status:
              verification.telegramStatus,

            error:
              verification.error ||
              null

          }

        });

      }


      /* ---------------------------------------------------
         SUBSCRIBED

         Existing Firebase data preserve रहेगा.
         केवल Hrry-specific fields update होंगे.
         --------------------------------------------------- */

      await db
        .ref(
          `telegram_bindings/${telegramId}`
        )
        .update({

          subscribed:
            true,

          subscriptionVerifiedAt:
            Date.now(),

          lastAccessCheckAt:
            Date.now(),

          nativeApp:
            'com.test.hrry'

        });


      /* ---------------------------------------------------
         ACCESS GRANTED
         --------------------------------------------------- */

      return res.json({

        success:
          true,

        bound:
          true,

        subscribed:
          true,

        blocked:
          false,

        telegramData: {

          ...binding,

          subscribed:
            true,

          nativeApp:
            'com.test.hrry'

        }

      });

    } catch (error) {

      console.error(

        'Hrry access check error:',

        error.response?.data ||
        error.message

      );

      return res
        .status(500)
        .json({

          success:
            false,

          error:
            'Access verification failed'

        });

    }

  }
);


/* =========================================================
   SERVER START
   ========================================================= */

const PORT =
  process.env.PORT ||
  3000;


app.listen(
  PORT,
  () => {

    console.log(
      `Server is running on port ${PORT}`
    );

  }
);
