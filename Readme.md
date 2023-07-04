# WHATIS

https://meshtastic.taubetele.com/

Not a pet. Not a product-grade. Just a try to educate `@kkwestt` to read this `Readme.md` and notify `@zwoelf` if it's read.

# Config it

```bash
cat servers.js
```

```js
module.exports.servers = [
  {
    address: 'mqtt://admin:password@address.com',
    name: 'address.com'
  },
  // whatever
]
```

Notice that this file is ignored.