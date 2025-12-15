const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const admin = require("firebase-admin");

const serviceAccount = require("./creative-arena-firebase-adminsdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


//middleware
app.use(express.json());
app.use(cors());


const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        console.log('decoded in the token', decoded);
        req.decoded_email = decoded.email;

        next();

    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.e8hxcyy.mongodb.net/?appName=Cluster0`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('creative_arena_db');
        const usersCollection = db.collection('users');
        const contestsCollection = db.collection('contests');
        const paymentsCollection = db.collection('payments');
        const submissionCollection = db.collection('submissions');



        //middleware admin before allowing admin activity
        //must be used after verifyFBToken middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await usersCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }

            next();
        }

        //verify creator
        const verifyCreator = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await usersCollection.findOne(query);

            if (!user || user.role !== 'creator') {
                return res.status(403).send({ message: 'forbidden access' });
            }

            next();
        }



        //User related api
        app.get('/users', async (req, res) => {
            const cursor = usersCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;

            const userExists = await usersCollection.findOne({ email })
            if (userExists) {
                return res.send({ message: 'user exists' })
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        })


        // update user role 
        app.patch('/users/:id/role', async (req, res) => {
            const { role } = req.body;
            const id = req.params.id;

            //validation
            if (!['user', 'creator', 'admin'].includes(role)) {
                return res.status(400).send({ message: 'Invalid role' });
            }

            const targetUser = await usersCollection.findOne({
                _id: new ObjectId(id)
            });

            // prevent admin from changing own role
            if (targetUser.email === req.decoded_email) {
                return res.status(403).send({
                    message: 'You cannot change your own role'
                });
            }

            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role } }
            );

            res.send(result);
        });




        //contests related api
        app.post('/contests', async (req, res) => {
            const contest = req.body;
            contest.status = "pending";
            contest.createdAt = new Date();
            contest.participants = [];

            const result = await contestsCollection.insertOne(contest);
            res.send(result);
        })


        //get all contests and pagination
        app.get('/contests', async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;

            const contests = await contestsCollection
                .find()
                .skip(skip)
                .limit(limit)
                .toArray();

            const total = await contestsCollection.countDocuments();

            res.send({
                contests,
                total
            });
        });


        // All approved contests
        app.get('/all-contests', async (req, res) => {
            const result = await contestsCollection
                .find({ status: 'approved' })
                .toArray();

            res.send(result);
        });



        //contests created by Specific Creator
        app.get('/contests-by-creator', async (req, res) => {
            const email = req.query.email;

            if (!email) {
                return res.status(400).send({ error: "Email is required" });
            }

            const result = await contestsCollection.find({ createdBy: email }).toArray();
            res.send(result);
        });

        //get contest by id for edit contests
        app.get('/contests/:id', async (req, res) => {
            const id = req.params.id;
            const result = await contestsCollection.findOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        //Update Contests by creator
        app.patch('/contests/:id', async (req, res) => {
            const id = req.params.id;
            const updated = req.body;

            const result = await contestsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updated }
            );

            res.send(result);
        });


        // update contest status
        app.patch('/contests/:id/status', async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;

            if (!['approved', 'rejected'].includes(status)) {
                return res.status(400).send({ message: 'Invalid status' });
            }

            const result = await contestsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status } }
            );

            res.send(result);
        });


        //delete contest
        app.delete('/contests/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const result = await contestsCollection.deleteOne(query);
            res.send(result);
        });





        //Payment related api
        app.post('/create-checkout-session', verifyFBToken, async (req, res) => {
            const { contestId, contestName, price } = req.body;
            const amount = parseInt(price) * 100;

            const email = req.decoded_email;

            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                mode: 'payment',
                customer_email: email,
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: `Please pay for: ${contestName}`,
                            },
                        },
                        quantity: 1,
                    },
                ],
                success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.CLIENT_URL}/contest/${contestId}`,
                metadata: {
                    contestId,
                    email,
                },
            });

            res.send({ url: session.url });
        });


        //Save payment
        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;

            const session = await stripe.checkout.sessions.retrieve(sessionId);

            const paymentInfo = {
                contestId: session.metadata.contestId,
                email: session.customer_email,
                amount: session.amount_total / 100,
                transactionId: session.payment_intent,
                paidAt: new Date(),
                status: 'paid',
            };

            // prevent duplicate payment
            const exists = await paymentsCollection.findOne({
                transactionId: paymentInfo.transactionId,
            });

            if (exists) {
                return res.send({ message: 'Payment already recorded' });
            }

            await paymentsCollection.insertOne(paymentInfo);

            //  store participant in DB
            await contestsCollection.updateOne(
                { _id: new ObjectId(paymentInfo.contestId) },
                { $addToSet: { participants: paymentInfo.email } }
            );

            res.send({ success: true });
        });



        //Participation api
        app.get('/my-participated', verifyFBToken, async (req, res) => {
            const email = req.query.email;

            if (!email) {
                return res.status(400).send({ message: 'Email required' });
            }

            //  get paid payments
            const payments = await paymentsCollection.find({
                email,
                status: 'paid'
            }).toArray();

            const contestIds = payments.map(p => new ObjectId(p.contestId));

            // get contests
            const contests = await contestsCollection.find({
                _id: { $in: contestIds }
            }).toArray();

            // merge payment info
            const result = contests.map(contest => {
                const payment = payments.find(
                    p => p.contestId === contest._id.toString()
                );

                return {
                    ...contest,
                    paymentStatus: payment?.status,
                    paidAt: payment?.paidAt
                };
            });

            res.send(result);
        });



        //Submissions api
        // Get submissions for  contest details page
        app.get('/submissions', verifyFBToken, async (req, res) => {
            const { contestId } = req.query;

            if (!contestId) {
                return res.status(400).send({ message: 'contestId required' });
            }

            const submissions = await submissionCollection
                .find({ contestId: new ObjectId(contestId) })
                .toArray();

            res.send(submissions);
        });



        app.post('/submissions', verifyFBToken, async (req, res) => {
            const submission = req.body;
            const email = req.decoded_email;

            //Check payment
            const paid = await paymentsCollection.findOne({
                contestId: submission.contestId,
                email,
                status: 'paid'
            });

            if (!paid) {
                return res.status(403).send({ message: 'Payment required' });
            }

            //Prevent duplicate submission
            const exists = await submissionCollection.findOne({
                contestId: submission.contestId,
                'participant.email': email
            });

            if (exists) {
                return res.status(409).send({ message: 'Already submitted' });
            }

            //Save submission
            const doc = {
                contestId: new ObjectId(submission.contestId),
                contestName: submission.contestName,
                participant: submission.participant,
                submissionText: submission.submissionText,
                submissionLink: submission.submissionLink,
                status: 'submitted',
                isWinner: false,
                submittedAt: new Date()
            };

            const result = await submissionCollection.insertOne(doc);
            res.send(result);
        });



        app.get('/creator/submissions', verifyFBToken, verifyCreator, async (req, res) => {
            const creatorEmail = req.decoded_email;

            const contests = await contestsCollection.find({
                createdBy: creatorEmail
            }).toArray();

            const contestIds = contests.map(c => c._id);

            const submissions = await submissionCollection.find({
                contestId: { $in: contestIds }
            }).toArray();

            res.send(submissions);
        });


        //Declare winner
        app.patch('/creator/declare-winner/:submissionId', verifyFBToken, verifyCreator, async (req, res) => {
            const { contestId } = req.body;
            const submissionId = req.params.submissionId;

            // Reset previous winner
            await submissionCollection.updateMany(
                { contestId: new ObjectId(contestId) },
                { $set: { isWinner: false, status: 'rejected' } }
            );

            //Set new winner
            const result = await submissionCollection.updateOne(
                { _id: new ObjectId(submissionId) },
                { $set: { isWinner: true, status: 'winner' } }
            );

            res.send(result);
        });



        // My winning contests api
        app.get('/my-winning-contests', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;

            const result = await submissionCollection.aggregate([
                {
                    $match: {
                        'participant.email': email,
                        isWinner: true
                    }
                },
                {
                    $lookup: {
                        from: 'contests',
                        localField: 'contestId',
                        foreignField: '_id',
                        as: 'contest'
                    }
                },
                { $unwind: '$contest' }
            ]).toArray();

            res.send(result);
        });



        //My Profile api
        // Update profile
        app.patch('/users/profile', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const { displayName, photoURL, bio } = req.body;

            const result = await usersCollection.updateOne(
                { email },
                {
                    $set: {
                        displayName,
                        photoURL,
                        bio
                    }
                }
            );

            res.send(result);
        });



        // get user's profile
        app.get('/users/me', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;

            const user = await usersCollection.findOne({ email });
            res.send(user);
        });



        //Win Statistics
        app.get('/users/win-stats', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;

            const participated = await submissionCollection.countDocuments({
                'participant.email': email
            });

            const won = await submissionCollection.countDocuments({
                'participant.email': email,
                isWinner: true
            });

            const winPercentage = participated
                ? Math.round((won / participated) * 100)
                : 0;

            res.send({
                participated,
                won,
                winPercentage
            });
        });


        //popular contests api
        app.get('/popular-contests', async (req, res) => {
            const result = await contestsCollection.aggregate([
                { $match: { status: 'approved' } },
                {
                    $addFields: {
                        participantsCount: {
                            $size: {
                                $ifNull: ['$participants', []]  // <-- default to empty array
                            }
                        }
                    }
                },
                { $sort: { participantsCount: -1 } },
                { $limit: 6 }
            ]).toArray();

            res.send(result);
        });


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Creative Arena!')
})

app.listen(port, () => {
    console.log(`Creative Arena app listening on port ${port}`)
})
