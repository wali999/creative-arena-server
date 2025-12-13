const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000

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


        //User related api
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


        //contests related api
        app.get('/contests', async (req, res) => {

        })


        app.post('/contests', async (req, res) => {
            const contest = req.body;
            contest.status = "pending";
            contest.createdAt = new Date();

            const result = await contestsCollection.insertOne(contest);
            res.send(result);
        })

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
