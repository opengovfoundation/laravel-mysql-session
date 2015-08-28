var Sequelize = require('sequelize');

module.exports = function (connect)
{
    function MySQLStore(database, user, password, options)
    {
        options = options || {};
        connect.session.Store.call(this, options);

        var self = this,
            forceSync = options.forceSync || false,
            checkExpirationInterval = options.checkExpirationInterval || 1000*60*10, // default 10 minutes.
            defaultExpiration = options.defaultExpiration || 60*60*24; // default 1 day.

        var sequelize = new Sequelize(database, user, password, options);

        var Session = sequelize.define('sessions', {
            id: {type: Sequelize.STRING, primaryKey: true},
            last_activity: Sequelize.INTEGER,
            payload: Sequelize.TEXT
        }, { timestamps: false });

        var initialized = false;

        function initialize(callback)
        {
            if (initialized) callback();
            else
            {
                sequelize.sync({force: forceSync})
                .on('success', function ()
                {
                    initialized = true;
                    callback();
                })
                .on('failure', function (error)
                {
                    console.log('Failed to initialize MySQL session store:');
                    console.log(error);
                    callback(error);
                });
            }
        }

        // Check periodically to clear out expired sessions.
        setInterval(function ()
        {
            initialize(function (error)
            {
                if (error) return;

                Session.destroy({'last_activity': {'lt': Math.round(Date.now() / 1000) - defaultExpiration}})
                // .on('success', function (sessions)
                // {
                //     console.log('success');
                // })
                .on('failure', function (error)
                {
                    console.log('Failed to fetch expired sessions:');
                    console.log(error);
                });
            });
        }, checkExpirationInterval);

        this.get = function (sid, fn)
        {
            var that = this;
            initialize(function (error)
            {
                if (error) return fn(error, null);
                Session.find({where: {'id': sid}})
                .on('success', function (record)
                {
                    var session = record && JSON.parse(record.payload);

                    if (session) {
                        if(!(session.passport && session.passport.user) && session.user)
                        {
                            if(!session.passport)
                            {
                                session.passport = {};
                            }
                            if(session && session.user)
                            {
                                session.passport.user = session.user;
                            }

                            that.set(sid, session);
                        }

                        if(!session.cookie)
                        {
                            session.cookie = {};
                        }
                        if (!(session.cookie && session.cookie.expires) && session.last_activity)
                        {
                            session.cookie.expires = session.last_activity + parseInt(sails.config.session.cookie.maxAge);
                        }
                        if(!(session.cookie && session.cookie.originalMaxAge))
                        {
                            session.cookie.originalMaxAge = sails.config.session.cookie.maxAge;
                        }
                        session.cookie.domain = sails.config.session.cookie.domain;
                    }

                    fn(null, session);
                })
                .on('failure', function (error)
                {
                    fn(error, null);
                });
            });
        };

        this.set = function (sid, session, fn)
        {
            if (session.passport && session.passport.user && !session.user) {
                session.user = session.passport.user;
            }

            initialize(function (error)
            {
                if (error) return fn && fn(error);
                Session.find({where: {'id': sid}})
                .on('success', function (record)
                {

                    if(session && !session.user && session.passport && session.passport.user)
                    {
                        session.user = session.passport.user;
                    }

                    if (!record)
                    {
                        record = Session.create({
                            id: sid,
                            payload: JSON.stringify(session),
                            last_activity: Math.round(Date.now() / 1000)
                        }).on('success', function ()
                        {
                            fn && fn();
                        })
                        .on('failure', function (error)
                        {
                            fn && fn(error);
                        });
                    }
                    else
                    {
                        Session.update({
                            payload: JSON.stringify(session),
                            last_activity: Math.round(Date.now() / 1000)
                        }, { id: sid })
                        .on('success', function ()
                        {
                            fn && fn();
                        })
                        .on('failure', function (error)
                        {
                            fn && fn(error);
                        });
                    }
                })
                .on('failure', function (error)
                {
                    fn && fn(error);
                });
            });
        };

        this.destroy = function (sid, fn)
        {
            initialize(function (error)
            {
                if (error) return fn && fn(error);
                Session.find({where: {'id': sid}})
                .on('success', function (record)
                {
                    if (record)
                    {
                        record.destroy()
                        .on('success', function ()
                        {
                            fn && fn();
                        })
                        .on('failure', function (error)
                        {
                            console.log('Session ' + sid + ' could not be destroyed:');
                            console.log(error);
                            fn && fn(error);
                        });
                    }
                    else fn && fn();
                })
                .on('failure', function (error)
                {
                    fn && fn(error);
                });
            });
        };

        this.length = function (callback)
        {
            initialize(function (error)
            {
                if (error) return callback(null);
                Session.count()
                .on('success', callback)
                .on('failure', function () { callback(null); });
            });
        };

        this.clear = function (callback)
        {
            sequelize.sync({force: true}, callback);
        };
    }

    MySQLStore.prototype.__proto__ = connect.session.Store.prototype;

    return MySQLStore;
};
