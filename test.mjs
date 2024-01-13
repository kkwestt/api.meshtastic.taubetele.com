import { createClient } from 'redis';

const testRedis = async () => {
    const redis = await createClient(redisConfig)
        .on('error', err => console.log('Redis Client Error', err))
        .connect();

    await redis.hSet('device:key', { 'name': 'value123', 'name2': 'value321' });
    const value = await redis.hGet('device:key', 'name');

    console.log('!!!', value)

    const keys = await redis.keys('device:*');

    // , (err, keys) => {
    //     console.log(err, keys)
    //     // res.json(keys);
    //     // results.forEach(function(key) {
    //     //   redis.hget(key, 'statut', function(err, statut) {
    //     //     if (parseInt(statut) === 2) {
    //     //       console.log(key, statut);
    //     //     }
    //     //   });
    //     // });
    //   });



    const values = await Promise.all(keys.map(key => redis.hGetAll(key)));

    const result = keys.reduce((object, key, index) => {
        object[key.substr(7,)] = values[index];
        return object;
    }, {})

    console.log(result);



    await client.disconnect();

    return client;

}

// testRedis();
