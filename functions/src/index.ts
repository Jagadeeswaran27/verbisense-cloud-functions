import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { onCall } from "firebase-functions/https";

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
