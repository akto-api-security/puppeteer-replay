import dotenv from 'dotenv';
dotenv.config();

import { MongoClient } from 'mongodb';

export const connectionString = process.env.MONGO_CONNECTION_STRING
const dbName = process.env.MONGO_DB_NAME
const collectionName = process.env.MONGO_COLLECTION_NAME

class MongoQueue {
    constructor(batchSize = 10) {
        this.client = new MongoClient(connectionString);
        this.queue = [];
        this.batchSize = batchSize;
        this.db = null;
        this.collection = null;
    }

    async connect() {
        console.log("Connecting to MongoDB");
        await this.client.connect().then(() => {
            this.db = this.client.db(dbName);
            this.collection = this.db.collection(collectionName);
            console.log("Connected to MongoDB", "db: ", dbName, "collection: ", collectionName);
        }).catch((err) => {
            console.log("Error connecting to MongoDB", "error: ", err);
        });
    }

    addLogToQueue(log) {
        if (!this.db || !this.collection) {
            return Promise.reject(new Error("Database not connected"));
        }
        return new Promise((resolve, reject) => {
            console.log("mongo queue: Adding log to queue", "queue length: ", this.queue.length);
            this.queue.push({
                log,
                resolve,
                reject
            });

            if (this.queue.length >= this.batchSize) {
                console.log("mongo queue: Flushing queue", "queue length: ", this.queue.length);
                this.flush();
            }
        });
    }

    flush() {
        if (!this.db || !this.collection) {
            return Promise.reject(new Error("Database not connected"));
        }
        const batch = this.queue.splice(0, this.batchSize);
        if (batch.length === 0) return;

        const documents = batch.map(item => item.log);

        this.collection.insertMany(documents)
            .then(() => {
                console.log("Mongo queue: Inserted logs", "batch length: ", batch.length);
                batch.forEach(item => item.resolve());
                this.queue = [];
                console.log("mongo queue: Queue flushed", "queue length: ", this.queue.length);
            })
            .catch(error => {
                console.log("mongo queue: Error inserting logs", "error: ", error);
                batch.forEach(item => item.reject(error));
            });
    }

    close() {
        this.client.close().catch((err) => {
            console.error(err);
        });
    }

    flushRemaining() {
        if (this.queue.length === 0) return;
        this.flush();
    }
    
}

export default MongoQueue;