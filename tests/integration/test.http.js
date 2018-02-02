'use strict';

describe('test.http.js', function () {

  var dbs = {};

  beforeEach(function () {
    dbs.name = testUtils.adapterUrl('http', 'test_http');
  });

  afterEach(function (done) {
    testUtils.cleanup([dbs.name], done);
  });

  it('Create a pouch without DB setup (skip_setup)', function (done) {
    var instantDB;
    testUtils.isCouchDB(function (isCouchDB) {
      if (!isCouchDB) {
        return done();
      }
      var db = new PouchDB(dbs.name);
      db.destroy(function () {
        instantDB = new PouchDB(dbs.name, { skip_setup: true });
        instantDB.post({ test: 'abc' }, function (err) {
          should.exist(err);
          err.name.should.equal('not_found', 'Skipped setup of database');
          done();
        });
      });
    });
  });

  it('Issue 1269 redundant _changes requests', function (done) {
    var docs = [];
    var num = 100;
    for (var i = 0; i < num; i++) {
      docs.push({
        _id: 'doc_' + i,
        foo: 'bar_' + i
      });
    }
    var db = new PouchDB(dbs.name);
    db.bulkDocs({ docs: docs }, function () {
      db.info(function (err, info) {
        var update_seq = info.update_seq;

        var callCount = 0;
        var ajax = db._ajax;
        db._ajax = function (opts) {
          if (/_changes/.test(opts.url)) {
            callCount++;
          }
          ajax.apply(this, arguments);
        };
        db.changes({
          since: update_seq
        }).on('change', function () {
        }).on('complete', function () {
          callCount.should.equal(1, 'One _changes call to complete changes');
          db._ajax = ajax;
          done();
        }).on('error', done);
      });
    });
  });

  it('handle ddocs with slashes', function (done) {
    var ddoc = {
      _id: '_design/foo/bar'
    };
    var db = new PouchDB(dbs.name);
    db.bulkDocs({ docs: [ddoc] }, function () {
      db.get(ddoc._id, function (err, doc) {
        should.not.exist(err);
        doc._id.should.equal(ddoc._id, 'Correct doc returned');
        done();
      });
    });
  });

  it('Properly escape url params #4008', function () {
    var db = new PouchDB(dbs.name);
    var ajax = db._ajax;
    db._ajax = function (opts) {
      opts.url.should.not.contain('[');
      ajax.apply(this, arguments);
    };
    return db.changes({doc_ids: ['1']}).then(function () {
      db._ajax = ajax;
    });
  });

  it('Allows the "ajax timeout" to extend "changes timeout"', function (done) {
    var timeout = 120000;
    var db = new PouchDB(dbs.name, {
      skip_setup: true,
      ajax: {
        timeout: timeout
      }
    });

    var ajax = db._ajax;
    var ajaxOpts;
    db._ajax = function (opts) {
      if (/changes/.test(opts.url)) {
        ajaxOpts = opts;
        changes.cancel();
      }
      ajax.apply(this, arguments);
    };

    var changes = db.changes();

    changes.on('complete', function () {
      should.exist(ajaxOpts);
      ajaxOpts.timeout.should.equal(timeout);
      db._ajax = ajax;
      done();
    });

  });

  it('Test custom header', function () {
    var db = new PouchDB(dbs.name, {
      headers: {
        'X-Custom': 'some-custom-header'
      }
    });
    return db.info();
  });

  it('test url too long error for allDocs()', function () {
    var docs = [];
    var numDocs = 75;
    for (var i = 0; i < numDocs; i++) {
      docs.push({
        _id: 'fairly_long_doc_name_' + i
      });
    }
    var db = new PouchDB(dbs.name);
    return db.bulkDocs(docs).then(function () {
      return db.allDocs({
        keys: docs.map(function (x) { return x._id; })
      });
    }).then(function (res) {
      res.rows.should.have.length(numDocs);
    });
  });

  it('4358 db.info rejects when server is down', function () {
    var db = new PouchDB('http://example.com/foo');
    return db.info().then(function () {
      throw new Error('expected an error');
    }).catch(function (err) {
      should.exist(err);
    });
  });

  it('4358 db.destroy rejects when server is down', function () {
    var db = new PouchDB('http://example.com/foo');
    return db.destroy().then(function () {
      throw new Error('expected an error');
    }).catch(function (err) {
      should.exist(err);
    });
  });


  it('5574 Create a pouch with / in name and prefix url', function () {
    // CouchDB Master disallows these characters
    if (testUtils.isCouchMaster()) {
      return true;
    }
    var db = new PouchDB('test/suffix', {
      prefix: testUtils.adapterUrl('http', '')
    });
    return db.info().then(function () {
      return db.destroy();
    });
  });

  it('Issue 6132 - default headers not merged', function () {
    var db = new PouchDB(dbs.name, {
      ajax: {
        // need to use a header that CouchDB allows through CORS
        headers: { "x-csrf-token": "bar" }
      }
    });

    var ajax = db._ajax;
    var tested = false;
    db._ajax = function (opts) {
      if (opts.headers && opts.headers['Content-Type']) {
        if (opts.headers["x-csrf-token"] !== 'bar') {
          throw new Error('default header x-csrf-token expected');
        }
        tested = true;
      }

      ajax.apply(this, arguments);
    };

    return db.putAttachment('mydoc', 'att.txt', testUtils.btoa('abc'), 'text/plain')
    .then(function () {
      if (!tested) {
        throw new Error('header assertion skipped in test');
      }
    });
  });

  it('heartbeart cannot be > request timeout', function (done) {
    var timeout = 500;
    var heartbeat = 1000;
    var CHANGES_TIMEOUT_BUFFER = 5000;
    var db = new PouchDB(dbs.name, {
      skip_setup: true,
      ajax: {
        timeout: timeout
      }
    });

    var ajax = db._ajax;
    var ajaxOpts;
    db._ajax = function (opts) {
      if (/changes/.test(opts.url)) {
        ajaxOpts = opts;
        changes.cancel();
      }
      ajax.apply(this, arguments);
    };

    var changes = db.changes({
        heartbeat: heartbeat
    });

    changes.on('complete', function () {
      should.exist(ajaxOpts);
      ajaxOpts.timeout.should.equal(heartbeat + CHANGES_TIMEOUT_BUFFER);
      ajaxOpts.url.indexOf("heartbeat=" + heartbeat).should.not.equal(-1);
      db._ajax = ajax;
      done();
    });

  });

  it('changes respects seq_interval', function (done) {
    var docs = [
      {_id: '0', integer: 0, string: '0'},
      {_id: '1', integer: 1, string: '1'},
      {_id: '2', integer: 2, string: '2'}
    ];

    var db = new PouchDB(dbs.name);
    var seqCount = 0;
    var changesCount = 0;
    db.bulkDocs(docs).then(function () {
      db.changes({ seq_interval: 4 })
      .on('change', function (change) {
        if (change.seq !== null) {
          seqCount++;
        }
        changesCount++;
      }).on('error', function (err) {
        done(err);
      }).on('complete', function (info) {
        try {
          changesCount.should.equal(3);

          // we can't know in advance which
          // order the changes arrive in so sort them
          // so that nulls appear last
          info.results.sort(function (a, b) {
            if (a.seq !== null && b.seq === null) {
              return -1;
            }

            if (a.seq === null && b.seq !== null) {
              return 1;
            }

            return 0;
          });

          // first change always contains a seq
          should.not.equal(info.results[0].seq, null);
          should.not.equal(info.last_seq, null);

          // CouchDB 1.x should just ignore seq_interval
          // (added in CouchDB 2.0), but not fail with an error
          if (testUtils.isCouchMaster()) {
            // one change (the "first") always contains a seq
            seqCount.should.equal(1);
            should.equal(info.results[1].seq, null);
            should.equal(info.results[2].seq, null);
          }
          else {
            seqCount.should.equal(3);
          }

          done();
        }
        catch (e) {
          done(e);
        }
      });
    });
  });
});
