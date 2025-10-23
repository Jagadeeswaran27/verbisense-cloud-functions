import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { onCall } from "firebase-functions/https";
import { onSchedule } from "firebase-functions/scheduler";

admin.initializeApp();

export const createUser = onCall(async (request) => {
  try {
    const { email, password, name } = request.data;
    if (!email || !password || !name) {
      logger.error("Missing required fields: email, password, name");
      throw new Error("Missing required fields: email, password, name");
    }
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
    });

    const userData = {
      uid: userRecord.uid,
      email: email,
      name: name,
    };

    await admin
      .firestore()
      .collection("users")
      .doc(userRecord.uid)
      .set(userData);

    logger.info("User created successfully:", userData);

    return { success: true, user: userData };
  } catch (error: any) {
    logger.error("Error creating user:", error);

    if (error.code) {
      throw new functions.https.HttpsError(
        "already-exists",
        error.message || "Error creating user",
        { code: error.code }
      );
    }

    throw new functions.https.HttpsError(
      "internal",
      "Unknown error creating user",
      { details: error.toString() }
    );
  }
});

export const dailyNotificationScheduler = onSchedule(
  { schedule: "0 8 * * *", timeZone: "UTC" },
  async () => {
    try {
      logger.info("Daily notification scheduler triggered at 8 AM UTC");

      const userSnapshot = await admin.firestore().collection("users").get();

      const tokens: string[] = userSnapshot.docs.flatMap((doc) => {
        const data = doc.data();
        const fcmTokens = data?.fcmToken as string[];
        if (Array.isArray(fcmTokens)) {
          return fcmTokens;
        }
        return [];
      });

      logger.info("FCM tokens collected:", tokens.length);

      if (tokens.length === 0) {
        logger.info("No FCM tokens found. Skipping notification send.");
        return;
      }

      const message = {
        notification: {
          title: "VerbiSense",
          body: "Hey There, Ready to use VerbiSense Today?",
        },
        data: {
          type: "daily_reminder",
          timestamp: new Date().toISOString(),
        },
        tokens: tokens,
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      logger.info("Notification sent successfully:", {
        successCount: response.successCount,
        failureCount: response.failureCount,
      });

      if (response.failureCount > 0) {
        logger.warn(`Failed to send ${response.failureCount} notifications`);

        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(tokens[idx]);
            logger.error(`Failed to send to token ${tokens[idx]}:`, resp.error);
          }
        });

        await cleanupInvalidTokens(failedTokens);
      }
    } catch (error) {
      logger.error("Error in daily notification scheduler:", error);
    }
  }
);

async function cleanupInvalidTokens(invalidTokens: string[]) {
  try {
    const batch = admin.firestore().batch();
    let operationCount = 0;

    for (const token of invalidTokens) {
      const userQuery = await admin
        .firestore()
        .collection("users")
        .where("fcmToken", "array-contains", token)
        .get();

      userQuery.forEach((doc) => {
        batch.update(doc.ref, {
          fcmToken: admin.firestore.FieldValue.arrayRemove(token),
        });
        operationCount++;
      });
    }

    if (operationCount > 0) {
      await batch.commit();
      logger.info(`Cleaned up ${operationCount} invalid FCM tokens`);
    }
  } catch (error) {
    logger.error("Error cleaning up invalid tokens:", error);
  }
}
