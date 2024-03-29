export default [
    {
        context: [
            "/resources"
        ],
        target: "http://localhost:1881",
        secure: false,
        logLevel : "debug"
    },
    {
      context: [
          "/gis"
      ],
      target: "http://192.168.30.4",
      secure: false,
      logLevel : "debug"
   }
  ];