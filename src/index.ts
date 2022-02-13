const functions = require("firebase-functions");
const admin = require("firebase-admin");
const TwitterApi = require("twitter-api-v2").default;
const {Configuration, OpenAIApi} = require("openai");
const {getRandomIntent} = require("./doNotPublish.js");

admin.initializeApp();
const clientId = process.env.TWITTER_CLIENT_ID;
const clientSecret = process.env.TWITTER_CLIENT_SECRET;
const apiKey = process.env.OPEN_API_SECRET_KEY;

const dbRef = admin.firestore().doc("tokens/twitter");
const twitterClient = new TwitterApi({
  clientId,
  clientSecret,
});

const callBackUrl = "http://127.0.0.1:5000/jaitwib/us-central1/callback";

const configuration = new Configuration({
  apiKey,
});
const openai = new OpenAIApi(configuration);

exports.auth = functions.https.onRequest(async (_, response) => {
  const {url, codeVerifier, state} = twitterClient.generateOAuth2AuthLink(
      callBackUrl,
      {scope: ["tweet.read", "tweet.write", "users.read", "offline.access"]}
  );

  // store verifier
  await dbRef.set({codeVerifier, state});

  response.redirect(url);
});

exports.callback = functions.https.onRequest(async (request, response)=> {
  const {state, code} = request.query;

  const dbSnapshot = await dbRef.get();
  // eslint-disable-next-line max-len
  const {codeVerifier, state: storedState} = dbSnapshot.data();

  if (state !== storedState) {
    return response.status(400).send("Stored tokens do not match!");
  }

  const {
    client: loggedClient,
    accessToken,
    refreshToken,
  } = await twitterClient.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: callBackUrl,
  });

  await dbRef.set({accessToken, refreshToken});

  const {data} = await loggedClient.v2.me();

  response.send(data);
});

exports.tweet = functions.https.onRequest(async (request, response) => {
  const {refreshToken} = (await dbRef.get()).data();

  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken,
  } = await twitterClient.refreshOAuth2Token(refreshToken);

  await dbRef.set({accessToken, refreshToken: newRefreshToken});

  const intent = getRandomIntent();
  const nextTweet = await openai.createCompletion("text-davinci-001", {
    prompt: intent,
    max_tokens: 64,
  });

  const {data} = await refreshedClient.v2.tweet(
      nextTweet.data.choices[0].text
  );

  response.send(data);
});

