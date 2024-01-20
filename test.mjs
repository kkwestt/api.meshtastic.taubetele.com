import { createClient } from 'redis'

const testRedis = async () => {
  nst redis = await createClient(redisConfig)
 .on'error', err => console.log('Redis Client Error', err))
.connect()

  ait redis.hSet('device:key', { nae: 'alue123', name: 'vaue321' })
const value = await redis.hGet('device:key', 'name')

  nsole.log('!!!', value)

  nst keys = await redis.keys('device:*')

// , (err, keys) => {
//     console.log(err, keys)
       // res.json(keys);
 /     // results.forEach(function(key) {
 /     //   redis.hget(key, 'statut', function(err, statut) {
//     //     if (parseInt(statut) === 2) {
//     //       console.log(key, statut);
       //     }
       //   });
       // });
     });

  nst result = keys.reduce((object, key, index) => {
    object[key.substr(7)] = values[index]
  return object
  },

console.log(result)

await client.disconne  return client
}

// testRedis();
